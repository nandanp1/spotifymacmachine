import {
  SpotifyApiError,
  type SpotifyApiClient,
  type SpotifyDevice,
  type SpotifyPlaybackSnapshot,
} from "../devices/spotify-api";
import {
  clampPosition,
  clampVolume,
  type ObservablePlaybackService,
  type PlaybackProblem,
  type PlaybackServiceStatus,
  type PlayerState,
  type PlayerTrack,
} from "./playback-service";

export type SpotifyRemotePlaybackApi = Pick<
  SpotifyApiClient,
  | "getAvailableDevices"
  | "getCurrentPlayback"
  | "startPlayback"
  | "resumePlayback"
  | "pausePlayback"
  | "skipToNext"
  | "skipToPrevious"
  | "seekPlayback"
  | "setPlaybackVolume"
>;

export interface SpotifyRemotePlaybackTarget {
  id: string;
  name: string;
  isRestricted: boolean;
  supportsVolume: boolean;
  volumePercent?: number | null;
}

export interface RemotePlaybackEnvironment {
  isOnline(): boolean;
  isVisible(): boolean;
  subscribeNetwork(listener: () => void): () => void;
  subscribeVisibility(listener: () => void): () => void;
}

export interface SpotifyRemotePlaybackServiceOptions {
  api: SpotifyRemotePlaybackApi;
  target: SpotifyRemotePlaybackTarget;
  pollIntervalMs?: number;
  environment?: RemotePlaybackEnvironment;
  now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MINIMUM_POLL_INTERVAL_MS = 250;

/**
 * Controls one explicitly selected Spotify device through the Web API. Audio
 * never plays in Aura Player through this service.
 */
export class SpotifyRemotePlaybackService
  implements ObservablePlaybackService
{
  private readonly api: SpotifyRemotePlaybackApi;
  private readonly pollIntervalMs: number;
  private readonly environment: RemotePlaybackEnvironment;
  private readonly now: () => number;
  private target: SpotifyRemotePlaybackTarget | null;
  private currentState: PlayerState | null = null;
  private status: PlaybackServiceStatus;
  private readonly stateListeners = new Set<
    (state: PlayerState | null) => void
  >();
  private readonly statusListeners = new Set<
    (status: PlaybackServiceStatus) => void
  >();
  private connectPromise: Promise<void> | null = null;
  private commandQueue: Promise<void> = Promise.resolve();
  private refreshPromise: Promise<PlayerState | null> | null = null;
  private refreshController: AbortController | null = null;
  private readonly commandControllers = new Set<AbortController>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  private lifecycleGeneration = 0;
  private connected = false;
  private rateLimitedUntil = 0;
  private quotaExceeded = false;

  constructor(options: SpotifyRemotePlaybackServiceOptions) {
    this.api = options.api;
    this.target = normalizeTarget(options.target);
    this.pollIntervalMs = Math.max(
      MINIMUM_POLL_INTERVAL_MS,
      Number.isFinite(options.pollIntervalMs)
        ? Math.round(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
        : DEFAULT_POLL_INTERVAL_MS,
    );
    this.environment =
      options.environment ?? createBrowserRemotePlaybackEnvironment();
    this.now = options.now ?? Date.now;
    this.status = {
      phase: "idle",
      deviceId: null,
      deviceName:
        this.target?.name ?? "Selected Spotify device",
      problem: null,
    };
  }

  getTarget(): SpotifyRemotePlaybackTarget | null {
    return this.target ? { ...this.target } : null;
  }

  getStatus(): PlaybackServiceStatus {
    return this.status;
  }

  subscribeStatus(
    listener: (status: PlaybackServiceStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribe(listener: (state: PlayerState | null) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.connected && this.status.phase === "ready") {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const generation = ++this.lifecycleGeneration;
    this.quotaExceeded = false;
    this.rateLimitedUntil = 0;
    const operation = this.performConnect(generation);
    this.connectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.connectPromise === operation) {
        this.connectPromise = null;
      }
    }
  }

  private async performConnect(generation: number): Promise<void> {
    this.clearPollTimer();
    this.attachEnvironmentListeners();
    this.setStatus({
      phase: "connecting",
      deviceId: null,
      problem: null,
    });

    if (!this.environment.isOnline()) {
      const problem = offlineProblem();
      this.setStatus({ phase: "offline", problem });
      this.detachEnvironmentListeners();
      throw problem;
    }

    try {
      const controller = this.createCommandController();
      try {
        const devices = await this.api.getAvailableDevices(
          controller.signal,
        );
        this.assertCurrentLifecycle(generation);
        this.verifyTargetFromDevices(devices);
        const snapshot = await this.api.getCurrentPlayback(
          controller.signal,
        );
        this.assertCurrentLifecycle(generation);
        this.applySnapshot(snapshot);
      } finally {
        this.commandControllers.delete(controller);
      }

      const target = this.requireTarget();
      this.connected = true;
      this.setStatus({
        phase: "ready",
        deviceId: target.id,
        deviceName: target.name,
        problem: null,
      });
      this.emitState();
      this.schedulePoll();
    } catch (error) {
      if (isAbortError(error) || generation !== this.lifecycleGeneration) {
        throw error;
      }
      this.connected = false;
      const problem = toPlaybackProblem(error);
      this.applyFailureStatus(problem);
      this.detachEnvironmentListeners();
      throw problem;
    }
  }

  async disconnect(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.connected = false;
    this.connectPromise = null;
    this.clearPollTimer();
    this.abortRefresh();
    this.refreshPromise = null;
    this.commandControllers.forEach((controller) => controller.abort());
    this.commandControllers.clear();
    this.detachEnvironmentListeners();
    this.currentState = null;
    this.rateLimitedUntil = 0;
    this.quotaExceeded = false;
    this.setStatus({
      phase: "idle",
      deviceId: null,
      problem: null,
    });
    this.emitState();
  }

  async play(uri?: string): Promise<void> {
    await this.enqueueCommand(
      (target, signal) =>
        uri
          ? this.api.startPlayback({
              uri,
              deviceId: target.id,
              signal,
            })
          : this.api.resumePlayback(target.id, signal),
      uri ? undefined : "resuming",
    );
  }

  async pause(): Promise<void> {
    await this.enqueueCommand(
      (target, signal) =>
        this.api.pausePlayback(target.id, signal),
      "pausing",
    );
  }

  async next(): Promise<void> {
    await this.enqueueCommand(
      (target, signal) =>
        this.api.skipToNext(target.id, signal),
      "skippingNext",
    );
  }

  async previous(): Promise<void> {
    await this.enqueueCommand(
      (target, signal) =>
        this.api.skipToPrevious(target.id, signal),
      "skippingPrevious",
    );
  }

  async seek(positionMs: number): Promise<void> {
    await this.enqueueCommand(
      (target, signal) => {
        const bounded = Math.round(
          clampPosition(
            positionMs,
            this.currentState?.durationMs ??
              Number.MAX_SAFE_INTEGER,
          ),
        );
        return this.api.seekPlayback(target.id, bounded, signal);
      },
      "seeking",
    );
  }

  async setVolume(volume: number): Promise<void> {
    const volumePercent = Math.round(clampVolume(volume) * 100);
    await this.enqueueCommand(
      (currentTarget, signal) =>
        this.api.setPlaybackVolume(
          currentTarget.id,
          volumePercent,
          signal,
        ),
      undefined,
      (target) => {
        if (!target.supportsVolume) {
          throw unsupportedVolumeProblem(target.name);
        }
      },
    );
  }

  async getState(): Promise<PlayerState | null> {
    return this.currentState;
  }

  private enqueueCommand(
    command: (
      target: SpotifyRemotePlaybackTarget,
      signal: AbortSignal,
    ) => Promise<void>,
    restriction?: keyof NonNullable<PlayerState["restrictions"]>,
    validateTarget?: (target: SpotifyRemotePlaybackTarget) => void,
  ): Promise<void> {
    const generation = this.lifecycleGeneration;
    const operation = this.commandQueue.then(async () => {
      this.assertCurrentLifecycle(generation);
      await this.runCommand(
        generation,
        command,
        restriction,
        validateTarget,
      );
    });
    this.commandQueue = operation.catch(() => undefined);
    return operation;
  }

  private async runCommand(
    generation: number,
    command: (
      target: SpotifyRemotePlaybackTarget,
      signal: AbortSignal,
    ) => Promise<void>,
    restriction?: keyof NonNullable<PlayerState["restrictions"]>,
    validateTarget?: (target: SpotifyRemotePlaybackTarget) => void,
  ): Promise<void> {
    this.assertCurrentLifecycle(generation);
    this.clearPollTimer();
    if (this.quotaExceeded) {
      throw this.status.problem ?? quotaExceededProblem();
    }
    if (!this.environment.isOnline()) {
      const problem = offlineProblem();
      this.setStatus({ phase: "offline", problem });
      throw problem;
    }

    if (this.now() < this.rateLimitedUntil) {
      const problem =
        this.status.problem?.code === "rate-limited"
          ? this.status.problem
          : rateLimitedProblem();
      this.schedulePoll(this.rateLimitedUntil - this.now());
      throw problem;
    }
    this.requireReadyTarget();
    try {
      await this.refreshState(generation);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const problem = toPlaybackProblem(error);
      this.handleRuntimeFailure(error, problem);
      this.schedulePoll();
      throw problem;
    }

    const target = this.requireReadyTarget();
    try {
      validateTarget?.(target);
    } catch (error) {
      this.schedulePoll();
      throw error;
    }
    if (restriction && this.currentState?.restrictions?.[restriction]) {
      this.schedulePoll();
      throw restrictedActionProblem(restriction, target.name);
    }

    const controller = this.createCommandController();
    try {
      await command(target, controller.signal);
      this.assertCurrentLifecycle(generation);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const problem = toPlaybackProblem(error);
      this.handleRuntimeFailure(error, problem);
      this.schedulePoll();
      throw problem;
    } finally {
      this.commandControllers.delete(controller);
    }

    try {
      await this.refreshState(generation);
    } catch (error) {
      if (!isAbortError(error)) {
        this.handleRuntimeFailure(error, toPlaybackProblem(error));
      }
    }
    this.schedulePoll();
  }

  private refreshState(
    generation = this.lifecycleGeneration,
  ): Promise<PlayerState | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const operation = this.performRefresh(generation);
    this.refreshPromise = operation;
    const clearRefresh = () => {
      if (this.refreshPromise === operation) {
        this.refreshPromise = null;
      }
    };
    void operation.then(clearRefresh, clearRefresh);
    return operation;
  }

  private async performRefresh(
    generation: number,
  ): Promise<PlayerState | null> {
    const target = this.requireTarget();
    const controller = new AbortController();
    this.refreshController = controller;
    try {
      const snapshot = await this.api.getCurrentPlayback(
        controller.signal,
      );
      this.assertCurrentLifecycle(generation);

      if (snapshot === null) {
        const devices = await this.api.getAvailableDevices(
          controller.signal,
        );
        this.assertCurrentLifecycle(generation);
        this.verifyTargetFromDevices(devices);
      } else {
        this.verifySnapshotTarget(snapshot, target.id);
      }

      this.applySnapshot(snapshot);
      const currentTarget = this.requireTarget();
      this.setStatus({
        phase: "ready",
        deviceId: currentTarget.id,
        deviceName: currentTarget.name,
        problem: null,
      });
      this.rateLimitedUntil = 0;
      this.emitState();
      return this.currentState;
    } finally {
      if (this.refreshController === controller) {
        this.refreshController = null;
      }
    }
  }

  private async poll(): Promise<void> {
    if (!this.shouldPoll()) {
      return;
    }
    const rateLimitDelay = this.rateLimitedUntil - this.now();
    if (rateLimitDelay > 0) {
      this.schedulePoll(rateLimitDelay);
      return;
    }

    try {
      await this.refreshState();
      this.schedulePoll();
    } catch (error) {
      if (isAbortError(error)) {
        if (this.shouldPoll()) {
          this.schedulePoll();
        }
        return;
      }
      const problem = toPlaybackProblem(error);
      const delay = this.handleRuntimeFailure(error, problem);
      if (delay !== null && this.shouldPoll()) {
        this.schedulePoll(delay);
      }
    }
  }

  private applySnapshot(snapshot: SpotifyPlaybackSnapshot | null): void {
    if (snapshot === null) {
      this.currentState = null;
      return;
    }

    const target = this.requireTarget();
    this.verifySnapshotTarget(snapshot, target.id);
    this.target = targetFromDevice(snapshot.device);
    const track = mapRemoteTrack(snapshot);
    const durationMs = track?.durationMs ?? 0;
    const volume =
      snapshot.device.volumePercent === null
        ? this.currentState?.volume ??
          normalizeInitialVolume(target.volumePercent)
        : clampVolume(snapshot.device.volumePercent / 100);
    this.currentState = {
      source: "spotify",
      track,
      paused: !snapshot.isPlaying,
      buffering: false,
      positionMs: clampPosition(snapshot.progressMs ?? 0, durationMs),
      durationMs,
      volume,
      deviceId: snapshot.device.id,
      ...(snapshot.contextUri
        ? { contextUri: snapshot.contextUri }
        : {}),
      repeatMode: snapshot.repeatMode,
      shuffle: snapshot.shuffle,
      restrictions: { ...snapshot.restrictions },
      observedAt: this.now(),
    };
  }

  private verifyTargetFromDevices(devices: readonly SpotifyDevice[]): void {
    const target = this.requireTarget();
    const device = devices.find(
      (candidate) => candidate.id === target.id,
    );
    if (!device) {
      throw missingTargetProblem(target.name);
    }
    if (device.isRestricted) {
      throw restrictedTargetProblem(device.name);
    }
    if (!device.isActive) {
      throw inactiveTargetProblem(device.name);
    }
    this.target = targetFromDevice(device);
  }

  private verifySnapshotTarget(
    snapshot: SpotifyPlaybackSnapshot,
    expectedId: string,
  ): void {
    if (
      snapshot.device.id !== expectedId ||
      !snapshot.device.isActive
    ) {
      throw changedTargetProblem();
    }
    if (snapshot.device.isRestricted) {
      throw restrictedTargetProblem(snapshot.device.name);
    }
  }

  private requireTarget(): SpotifyRemotePlaybackTarget {
    if (!this.target) {
      throw missingTargetProblem();
    }
    return this.target;
  }

  private requireReadyTarget(): SpotifyRemotePlaybackTarget {
    const target = this.requireTarget();
    if (!this.connected) {
      throw missingTargetProblem(target.name);
    }
    return target;
  }

  private handleRuntimeFailure(
    error: unknown,
    problem: PlaybackProblem,
  ): number | null {
    if (problem.code === "no-device") {
      this.invalidateTarget(problem);
      return null;
    }
    if (
      problem.code === "authentication" ||
      problem.code === "premium-required"
    ) {
      this.clearPollTimer();
      this.setStatus({ phase: "error", problem });
      return null;
    }
    if (
      error instanceof SpotifyApiError &&
      error.code === "quota-exceeded"
    ) {
      this.clearPollTimer();
      this.quotaExceeded = true;
      this.setStatus({ phase: "error", problem });
      return null;
    }
    if (problem.code === "rate-limited") {
      this.clearPollTimer();
      const retryAfterMs =
        error instanceof SpotifyApiError &&
        error.retryAfterSeconds !== null
          ? error.retryAfterSeconds * 1_000
          : this.pollIntervalMs;
      const delay = Math.max(this.pollIntervalMs, retryAfterMs);
      this.rateLimitedUntil = this.now() + delay;
      this.setStatus({ phase: "reconnecting", problem });
      return delay;
    }
    if (problem.code === "network") {
      this.setStatus({
        phase: this.environment.isOnline() ? "reconnecting" : "offline",
        problem,
      });
      return this.environment.isOnline()
        ? this.pollIntervalMs
        : null;
    }

    this.setStatus({ phase: "reconnecting", problem });
    return this.pollIntervalMs;
  }

  private applyFailureStatus(problem: PlaybackProblem): void {
    if (problem.code === "no-device") {
      this.invalidateTarget(problem);
      return;
    }
    this.setStatus({
      phase:
        problem.code === "network" && !this.environment.isOnline()
          ? "offline"
          : "error",
      problem,
    });
  }

  private invalidateTarget(problem: PlaybackProblem): void {
    const previousName = this.target?.name ?? this.status.deviceName;
    this.connected = false;
    this.target = null;
    this.clearPollTimer();
    this.setStatus({
      phase: "unavailable",
      deviceId: null,
      deviceName: previousName,
      problem,
    });
  }

  private schedulePoll(delayMs = this.pollIntervalMs): void {
    this.clearPollTimer();
    if (!this.shouldPoll()) {
      return;
    }
    const rateLimitDelay = Math.max(
      0,
      this.rateLimitedUntil - this.now(),
    );
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, Math.max(0, delayMs, rateLimitDelay));
  }

  private shouldPoll(): boolean {
    return (
      this.connected &&
      !this.quotaExceeded &&
      this.target !== null &&
      this.environment.isOnline() &&
      this.environment.isVisible() &&
      (this.status.phase === "ready" ||
        this.status.phase === "reconnecting")
    );
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private abortRefresh(): void {
    this.refreshController?.abort();
    this.refreshController = null;
  }

  private createCommandController(): AbortController {
    const controller = new AbortController();
    this.commandControllers.add(controller);
    return controller;
  }

  private assertCurrentLifecycle(generation: number): void {
    if (generation !== this.lifecycleGeneration) {
      throw new DOMException(
        "Remote playback operation was cancelled.",
        "AbortError",
      );
    }
  }

  private setStatus(
    patch: Partial<PlaybackServiceStatus> &
      Pick<PlaybackServiceStatus, "phase">,
  ): void {
    this.status = {
      ...this.status,
      ...patch,
    };
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  private emitState(): void {
    this.stateListeners.forEach((listener) =>
      listener(this.currentState),
    );
  }

  private attachEnvironmentListeners(): void {
    if (this.unsubscribeNetwork || this.unsubscribeVisibility) {
      return;
    }
    this.unsubscribeNetwork = this.environment.subscribeNetwork(
      this.handleEnvironmentChange,
    );
    this.unsubscribeVisibility =
      this.environment.subscribeVisibility(
        this.handleEnvironmentChange,
      );
  }

  private detachEnvironmentListeners(): void {
    this.unsubscribeNetwork?.();
    this.unsubscribeVisibility?.();
    this.unsubscribeNetwork = null;
    this.unsubscribeVisibility = null;
  }

  private readonly handleEnvironmentChange = (): void => {
    if (!this.connected || this.quotaExceeded) {
      return;
    }
    this.clearPollTimer();
    if (!this.environment.isOnline()) {
      this.abortRefresh();
      this.setStatus({
        phase: "offline",
        problem: offlineProblem(),
      });
      return;
    }
    if (!this.environment.isVisible()) {
      this.abortRefresh();
      return;
    }

    this.setStatus({ phase: "reconnecting", problem: null });
    void this.poll();
  };
}

function mapRemoteTrack(
  snapshot: SpotifyPlaybackSnapshot,
): PlayerTrack | null {
  const track = snapshot.track;
  if (!track) {
    return null;
  }
  return {
    id: track.id,
    uri: track.uri,
    title: track.title,
    artists: [...track.artists],
    album: track.album.name,
    ...(track.album.uri ? { albumUri: track.album.uri } : {}),
    durationMs: track.durationMs,
    artwork: track.album.images.map((image) => ({ ...image })),
    ...(track.isPlayable === undefined
      ? {}
      : { isPlayable: track.isPlayable }),
  };
}

function normalizeTarget(
  target: SpotifyRemotePlaybackTarget,
): SpotifyRemotePlaybackTarget | null {
  const id = target.id.trim();
  const name = target.name.trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    isRestricted: target.isRestricted,
    supportsVolume: target.supportsVolume,
    volumePercent:
      target.volumePercent === undefined
        ? null
        : target.volumePercent,
  };
}

function targetFromDevice(
  device: SpotifyDevice,
): SpotifyRemotePlaybackTarget {
  if (!device.id) {
    throw missingTargetProblem(device.name);
  }
  return {
    id: device.id,
    name: device.name,
    isRestricted: device.isRestricted,
    supportsVolume: device.supportsVolume,
    volumePercent: device.volumePercent,
  };
}

function normalizeInitialVolume(
  volumePercent: number | null | undefined,
): number {
  return volumePercent === null || volumePercent === undefined
    ? 0.72
    : clampVolume(volumePercent / 100);
}

function toPlaybackProblem(error: unknown): PlaybackProblem {
  if (isPlaybackProblem(error)) {
    return error;
  }
  if (error instanceof SpotifyApiError) {
    const code =
      error.code === "authentication"
        ? "authentication"
        : error.code === "premium-required"
          ? "premium-required"
          : error.code === "no-active-device"
            ? "no-device"
            : error.code === "rate-limited"
              ? "rate-limited"
              : error.code === "quota-exceeded"
                ? "rate-limited"
              : error.code === "network"
                ? "network"
                : error.code === "invalid-request"
                  ? "track-unavailable"
                  : "playback";
    return {
      code,
      message: error.message,
      recoverable:
        error.code !== "quota-exceeded" &&
        code !== "premium-required" &&
        code !== "authentication",
      action: error.action,
      cause: error,
    };
  }
  return {
    code: "unknown",
    message: "Remote Spotify control failed.",
    recoverable: true,
    action: "Refresh Available Devices and try again.",
    cause: error,
  };
}

function isPlaybackProblem(value: unknown): value is PlaybackProblem {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "recoverable" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.recoverable === "boolean"
  );
}

function missingTargetProblem(deviceName?: string): PlaybackProblem {
  return {
    code: "no-device",
    message: deviceName
      ? `${deviceName} is no longer available for remote control.`
      : "Choose a Spotify device before using remote playback controls.",
    recoverable: true,
    action: "Open Available Devices and select an active device.",
  };
}

function inactiveTargetProblem(deviceName: string): PlaybackProblem {
  return {
    code: "no-device",
    message: `${deviceName} is not the active Spotify device.`,
    recoverable: true,
    action:
      "Transfer playback to that device explicitly, then connect remote control.",
  };
}

function changedTargetProblem(): PlaybackProblem {
  return {
    code: "no-device",
    message: "Spotify playback moved to another device.",
    recoverable: true,
    action: "Open Available Devices and choose the device to control.",
  };
}

function restrictedTargetProblem(deviceName: string): PlaybackProblem {
  return {
    code: "no-device",
    message: `${deviceName} does not allow remote playback commands.`,
    recoverable: true,
    action: "Choose a non-restricted Spotify device.",
  };
}

function restrictedActionProblem(
  restriction: keyof NonNullable<PlayerState["restrictions"]>,
  deviceName: string,
): PlaybackProblem {
  const actionName =
    restriction === "pausing"
      ? "pausing"
      : restriction === "resuming"
        ? "resuming"
        : restriction === "seeking"
          ? "seeking"
          : restriction === "skippingNext"
            ? "skipping to the next item"
            : "skipping to the previous item";
  return {
    code: "playback",
    message: `Spotify does not allow ${actionName} on ${deviceName} right now.`,
    recoverable: true,
    action: "Wait for the current item to finish or choose another device.",
  };
}

function unsupportedVolumeProblem(deviceName: string): PlaybackProblem {
  return {
    code: "playback",
    message: `${deviceName} does not support remote volume control.`,
    recoverable: true,
    action: "Adjust volume on the device itself.",
  };
}

function offlineProblem(): PlaybackProblem {
  return {
    code: "network",
    message: "Aura Player is offline.",
    recoverable: true,
    action:
      "Reconnect to the network, then select the Spotify device again if needed.",
  };
}

function rateLimitedProblem(): PlaybackProblem {
  return {
    code: "rate-limited",
    message: "Spotify is temporarily rate limiting remote control.",
    recoverable: true,
    action: "Wait before trying another playback command.",
  };
}

function quotaExceededProblem(): PlaybackProblem {
  return {
    code: "rate-limited",
    message: "Spotify API quota is exhausted for this application.",
    recoverable: false,
    action:
      "Wait for Spotify's application quota to reset before reconnecting remote control.",
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError"
    )
  );
}

function createBrowserRemotePlaybackEnvironment(): RemotePlaybackEnvironment {
  return {
    isOnline: () =>
      typeof navigator === "undefined" || navigator.onLine,
    isVisible: () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible",
    subscribeNetwork: (listener) => {
      if (typeof window === "undefined") {
        return () => undefined;
      }
      window.addEventListener("online", listener);
      window.addEventListener("offline", listener);
      return () => {
        window.removeEventListener("online", listener);
        window.removeEventListener("offline", listener);
      };
    },
    subscribeVisibility: (listener) => {
      if (typeof document === "undefined") {
        return () => undefined;
      }
      document.addEventListener("visibilitychange", listener);
      return () => {
        document.removeEventListener("visibilitychange", listener);
      };
    },
  };
}
