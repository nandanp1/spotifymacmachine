import type { AuraDesktopApi, RecoverySignal } from "@shared/types";

import {
  clampPosition,
  clampVolume,
  estimatePlaybackPosition,
  type ObservablePlaybackService,
  type PlaybackProblem,
  type PlaybackRestrictions,
  type PlaybackServiceStatus,
  type PlayerState,
  type PlayerTrack,
} from "./playback-service";

type OAuthTokenProvider = () => Promise<string>;

export interface SpotifyPlaybackServiceOptions {
  getOAuthToken: OAuthTokenProvider;
  deviceName?: string;
  initialVolume?: number;
  sdkUrl?: string;
  fetchImplementation?: typeof fetch;
  onDeviceReady?: (deviceId: string) => void;
}

interface SpotifySdkImage {
  url: string;
  width?: number;
  height?: number;
}

interface SpotifySdkTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    uri?: string;
    images?: SpotifySdkImage[];
  };
}

interface SpotifySdkState {
  paused: boolean;
  loading?: boolean;
  position: number;
  duration: number;
  repeat_mode?: number;
  shuffle?: boolean;
  context?: { uri?: string };
  disallows?: Record<string, boolean>;
  track_window: {
    current_track: SpotifySdkTrack;
  };
}

type SpotifyPlayerEvent =
  | "ready"
  | "not_ready"
  | "player_state_changed"
  | "initialization_error"
  | "authentication_error"
  | "account_error"
  | "playback_error";

interface SpotifySdkPlayer {
  addListener(
    event: SpotifyPlayerEvent,
    listener: (payload: unknown) => void,
  ): boolean;
  removeListener(event?: SpotifyPlayerEvent): boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
  getCurrentState(): Promise<unknown>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getVolume(): Promise<number>;
}

interface SpotifySdkNamespace {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume: number;
    enableMediaSession?: boolean;
  }) => SpotifySdkPlayer;
}

declare global {
  interface Window {
    Spotify?: SpotifySdkNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkLoadPromise: Promise<SpotifySdkNamespace> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getInstalledSpotifySdk(): SpotifySdkNamespace | null {
  const candidate: unknown = window.Spotify;
  if (!isRecord(candidate) || typeof candidate.Player !== "function") {
    return null;
  }
  return candidate as unknown as SpotifySdkNamespace;
}

function payloadMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  return typeof payload.message === "string" ? payload.message : undefined;
}

function payloadDeviceId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return isNonemptyString(payload.device_id) ? payload.device_id : null;
}

function makeProblem(
  code: PlaybackProblem["code"],
  message: string,
  action: string | undefined,
  cause?: unknown,
): PlaybackProblem {
  return {
    code,
    message,
    recoverable: code !== "premium-required" && code !== "account",
    action,
    cause,
  };
}

export function loadSpotifyPlaybackSdk(
  sdkUrl = "https://sdk.scdn.co/spotify-player.js",
  timeoutMs = 15_000,
): Promise<SpotifySdkNamespace> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      new Error("Spotify playback requires a browser renderer."),
    );
  }

  const installedSdk = getInstalledSpotifySdk();
  if (installedSdk) {
    return Promise.resolve(installedSdk);
  }

  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise<SpotifySdkNamespace>((resolve, reject) => {
    const previousReadyCallback = window.onSpotifyWebPlaybackSDKReady;
    let settled = false;
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${sdkUrl}"]`,
    );

    const handleScriptError = () => {
      finish({
        ok: false,
        error: new Error("The Spotify playback SDK failed to load."),
      });
    };

    const readyCallback = () => {
      try {
        previousReadyCallback?.();
      } catch {
        // An unrelated callback must not strand this loader's cleanup.
      }
      const sdk = getInstalledSpotifySdk();
      if (sdk) {
        finish({ ok: true, sdk });
      } else {
        finish({
          ok: false,
          error: new Error(
            "Spotify SDK signaled ready without a Player API.",
          ),
        });
      }
    };

    const finish = (
      result:
        | { ok: true; sdk: SpotifySdkNamespace }
        | { ok: false; error: Error },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      script?.removeEventListener("error", handleScriptError);
      if (window.onSpotifyWebPlaybackSDKReady === readyCallback) {
        if (previousReadyCallback) {
          window.onSpotifyWebPlaybackSDKReady = previousReadyCallback;
        } else {
          delete window.onSpotifyWebPlaybackSDKReady;
        }
      }

      if (result.ok) {
        resolve(result.sdk);
      } else {
        script?.remove();
        script = null;
        sdkLoadPromise = null;
        reject(result.error);
      }
    };

    window.onSpotifyWebPlaybackSDKReady = readyCallback;

    const timeoutId = window.setTimeout(() => {
      finish({
        ok: false,
        error: new Error("Timed out while loading the Spotify playback SDK."),
      });
    }, timeoutMs);

    if (script) {
      script.addEventListener("error", handleScriptError, { once: true });
      return;
    }

    script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.id = "spotify-web-playback-sdk";
    script.addEventListener("error", handleScriptError, { once: true });
    document.head.append(script);
  });

  return sdkLoadPromise;
}

export class SpotifyPlaybackService implements ObservablePlaybackService {
  private readonly options: Required<
    Pick<
      SpotifyPlaybackServiceOptions,
      "deviceName" | "initialVolume" | "sdkUrl"
    >
  > &
    SpotifyPlaybackServiceOptions;

  private readonly fetchImplementation: typeof fetch;
  private player: SpotifySdkPlayer | null = null;
  private currentState: PlayerState | null = null;
  private listeners = new Set<(state: PlayerState | null) => void>();
  private statusListeners = new Set<
    (status: PlaybackServiceStatus) => void
  >();
  private status: PlaybackServiceStatus;
  private connectPromise: Promise<void> | null = null;
  private recoveryPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeat = Date.now();
  private recoveryListenersAttached = false;
  private nativeRecoveryUnsubscribe: (() => void) | null = null;
  private disposed = false;
  private lifecycleGeneration = 0;
  private stateSequence = 0;

  constructor(options: SpotifyPlaybackServiceOptions) {
    this.options = {
      ...options,
      deviceName: options.deviceName ?? "Aura Player — Mac",
      initialVolume: clampVolume(options.initialVolume ?? 0.72),
      sdkUrl: options.sdkUrl ?? "https://sdk.scdn.co/spotify-player.js",
    };
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.status = {
      phase: "idle",
      deviceId: null,
      deviceName: this.options.deviceName,
      problem: null,
    };
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
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.player) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.disposed = false;
    const generation = ++this.lifecycleGeneration;
    const connection = this.performConnect(generation);
    this.connectPromise = connection;
    try {
      await connection;
    } finally {
      if (this.connectPromise === connection) {
        this.connectPromise = null;
      }
    }
  }

  private async performConnect(generation: number): Promise<void> {
    this.setStatus({ phase: "loading-sdk", problem: null });

    let sdk: SpotifySdkNamespace;
    try {
      sdk = await loadSpotifyPlaybackSdk(this.options.sdkUrl);
    } catch (cause) {
      const problem = makeProblem(
        "sdk-unavailable",
        "Spotify playback could not start in this renderer.",
        "Check the network and packaged DRM support, then try again.",
        cause,
      );
      this.setStatus({ phase: "unavailable", problem });
      throw problem;
    }
    if (!this.isCurrentLifecycle(generation)) {
      throw new DOMException("Spotify connection was cancelled.", "AbortError");
    }

    this.setStatus({ phase: "connecting", problem: null });

    const player = new sdk.Player({
      name: this.options.deviceName,
      volume: this.options.initialVolume,
      enableMediaSession: true,
      getOAuthToken: (callback) => {
        void this.provideToken(callback);
      },
    });

    this.player = player;
    this.attachSdkListeners(player);
    this.attachRecoveryListeners();

    try {
      const connected = await player.connect();
      if (!connected) {
        throw new Error("Spotify declined the playback connection.");
      }
      if (!this.isCurrentLifecycle(generation)) {
        player.disconnect();
        throw new DOMException(
          "Spotify connection was cancelled.",
          "AbortError",
        );
      }
      this.startHeartbeat();
    } catch (cause) {
      if (this.player === player) {
        this.player = null;
      }
      player.removeListener();
      player.disconnect();
      this.detachRecoveryListeners();
      if (!this.isCurrentLifecycle(generation)) {
        throw cause;
      }
      const problem = makeProblem(
        "initialization",
        "Aura Player could not initialize Spotify playback.",
        "Reconnect Spotify and try again.",
        cause,
      );
      this.setStatus({ phase: "error", problem });
      throw problem;
    }
  }

  private async provideToken(callback: (token: string) => void): Promise<void> {
    try {
      const token = await this.options.getOAuthToken();
      if (!token.trim()) {
        throw new Error("The token provider returned an empty token.");
      }
      callback(token);
    } catch (cause) {
      this.setStatus({
        phase: "error",
        problem: makeProblem(
          "authentication",
          "Spotify authorization expired or could not be refreshed.",
          "Sign in to Spotify again.",
          cause,
        ),
      });
    }
  }

  private attachSdkListeners(player: SpotifySdkPlayer): void {
    player.addListener("ready", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      const deviceId = payloadDeviceId(payload);
      if (!deviceId) {
        return;
      }

      this.stateSequence += 1;
      this.setStatus({
        phase: "ready",
        deviceId,
        problem: null,
      });
      this.startHeartbeat();
      this.options.onDeviceReady?.(deviceId);
      void this.refreshState();
    });

    player.addListener("not_ready", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      const unavailableDevice = payloadDeviceId(payload);
      const isCurrentDevice =
        !unavailableDevice || unavailableDevice === this.status.deviceId;
      if (isCurrentDevice) {
        this.enterUnavailableState(
          navigator.onLine ? "reconnecting" : "offline",
          makeProblem(
            "network",
            "Aura Player temporarily lost its Spotify connection.",
            "Keep the app open while it reconnects.",
          ),
        );
      }
    });

    player.addListener("player_state_changed", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      this.queueStatePayload(player, payload);
    });

    player.addListener("initialization_error", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      this.enterUnavailableState(
        "error",
        makeProblem(
          "initialization",
          payloadMessage(payload) ?? "Spotify playback failed to initialize.",
          "Restart Aura Player. If packaged playback still fails, verify DRM support.",
          payload,
        ),
      );
    });

    player.addListener("authentication_error", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      this.enterUnavailableState(
        "error",
        makeProblem(
          "authentication",
          payloadMessage(payload) ?? "Spotify rejected the access token.",
          "Sign in to Spotify again.",
          payload,
        ),
      );
    });

    player.addListener("account_error", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      this.enterUnavailableState(
        "error",
        makeProblem(
          "premium-required",
          payloadMessage(payload) ??
            "Spotify Premium is required for playback in Aura Player.",
          "Use a Spotify Premium account or continue with the clearly labeled demo.",
          payload,
        ),
      );
    });

    player.addListener("playback_error", (payload) => {
      if (!this.isActivePlayer(player)) {
        return;
      }
      this.setStatus({
        phase: "error",
        problem: makeProblem(
          "playback",
          payloadMessage(payload) ?? "Spotify could not play this track.",
          "Choose another track or playback device.",
          payload,
        ),
      });
    });
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.connectPromise = null;
    this.recoveryPromise = null;
    this.stateSequence += 1;
    this.stopHeartbeat();
    this.detachRecoveryListeners();

    if (this.player) {
      this.player.removeListener();
      this.player.disconnect();
      this.player = null;
    }

    this.currentState = null;
    this.setStatus({
      phase: "idle",
      deviceId: null,
      problem: null,
    });
    this.emitState();
  }

  private isCurrentLifecycle(generation: number): boolean {
    return !this.disposed && generation === this.lifecycleGeneration;
  }

  private isActivePlayer(player: SpotifySdkPlayer): boolean {
    return !this.disposed && this.player === player;
  }

  async play(uri?: string): Promise<void> {
    const player = this.requirePlayer();
    if (uri) {
      await this.requestSpotify(
        `/me/player/play?device_id=${encodeURIComponent(
          this.requireDeviceId(),
        )}`,
        {
          method: "PUT",
          body: JSON.stringify({ uris: [uri] }),
        },
      );
      return;
    }
    await player.resume();
  }

  async pause(): Promise<void> {
    await this.requirePlayer().pause();
  }

  async next(): Promise<void> {
    await this.requirePlayer().nextTrack();
  }

  async previous(): Promise<void> {
    await this.requirePlayer().previousTrack();
  }

  async seek(positionMs: number): Promise<void> {
    const duration = this.currentState?.durationMs ?? Number.MAX_SAFE_INTEGER;
    await this.requirePlayer().seek(clampPosition(positionMs, duration));
  }

  async setVolume(volume: number): Promise<void> {
    await this.requirePlayer().setVolume(clampVolume(volume));
    await this.refreshState();
  }

  async getState(): Promise<PlayerState | null> {
    this.requirePlayer();
    await this.refreshState();
    return this.currentState;
  }

  private async refreshState(): Promise<void> {
    const player = this.player;
    if (!player || this.disposed || this.status.phase !== "ready") {
      return;
    }
    const sequence = ++this.stateSequence;
    const generation = this.lifecycleGeneration;
    try {
      const payload = await player.getCurrentState();
      if (payload === null) {
        this.applyMappedState(player, generation, sequence, null);
        return;
      }
      if (!isSpotifyState(payload)) {
        return;
      }
      const state = await this.mapState(player, payload);
      this.applyMappedState(player, generation, sequence, state);
    } catch {
      // A status listener will report actionable SDK/network failures. A failed
      // refresh is not allowed to fabricate or overwrite the last known song.
    }
  }

  private async mapState(
    player: SpotifySdkPlayer,
    state: SpotifySdkState,
  ): Promise<PlayerState> {
    const sdkTrack = state.track_window.current_track;
    const track: PlayerTrack = {
      id: sdkTrack.id,
      uri: sdkTrack.uri,
      title: sdkTrack.name,
      artists: sdkTrack.artists.map((artist) => artist.name),
      album: sdkTrack.album.name,
      albumUri: sdkTrack.album.uri,
      durationMs: sdkTrack.duration_ms,
      artwork: (sdkTrack.album.images ?? []).map((image) => ({
        url: image.url,
        width: image.width,
        height: image.height,
      })),
    };
    const durationMs =
      Number.isFinite(state.duration) && state.duration > 0
        ? state.duration
        : track.durationMs;
    const paused = state.paused;
    const buffering = Boolean(state.loading);
    const positionMs = clampPosition(state.position, durationMs);
    const deviceId = this.status.deviceId;
    const contextUri = state.context?.uri;
    const repeatMode =
      state.repeat_mode === 2
        ? "track"
        : state.repeat_mode === 1
          ? "context"
          : "off";
    const shuffle = state.shuffle;
    const restrictions = mapRestrictions(state.disallows);
    const volume = clampVolume(await player.getVolume());

    return {
      source: "spotify",
      track,
      paused,
      buffering,
      positionMs,
      durationMs,
      volume,
      deviceId,
      contextUri,
      repeatMode,
      shuffle,
      restrictions,
      observedAt: Date.now(),
    };
  }

  private queueStatePayload(
    player: SpotifySdkPlayer,
    payload: unknown,
  ): void {
    const sequence = ++this.stateSequence;
    const generation = this.lifecycleGeneration;
    if (this.status.phase !== "ready") {
      return;
    }
    if (payload === null) {
      this.applyMappedState(player, generation, sequence, null);
      return;
    }
    if (!isSpotifyState(payload)) {
      return;
    }

    void this.mapState(player, payload)
      .then((state) => {
        this.applyMappedState(player, generation, sequence, state);
      })
      .catch(() => {
        // A rejected volume/state read cannot become an unhandled rejection or
        // displace the last complete state.
      });
  }

  private applyMappedState(
    player: SpotifySdkPlayer,
    generation: number,
    sequence: number,
    state: PlayerState | null,
  ): void {
    if (
      !this.isCurrentLifecycle(generation) ||
      this.player !== player ||
      this.status.phase !== "ready" ||
      sequence !== this.stateSequence
    ) {
      return;
    }

    this.currentState = state;
    this.emitState();
  }

  private enterUnavailableState(
    phase: PlaybackServiceStatus["phase"],
    problem: PlaybackProblem | null,
  ): void {
    this.freezeCurrentState();
    this.setStatus({
      phase,
      deviceId: null,
      problem,
    });
  }

  private freezeCurrentState(): void {
    this.stateSequence += 1;
    if (this.currentState === null) {
      return;
    }

    const now = Date.now();
    this.currentState = {
      ...this.currentState,
      paused: true,
      buffering: false,
      positionMs: estimatePlaybackPosition(this.currentState, now),
      deviceId: null,
      observedAt: now,
    };
    this.emitState();
  }

  private requirePlayer(): SpotifySdkPlayer {
    if (!this.player) {
      throw makeProblem(
        "sdk-unavailable",
        "Spotify playback is not connected.",
        "Connect Aura Player to Spotify first.",
      );
    }
    return this.player;
  }

  private requireDeviceId(): string {
    if (!this.status.deviceId) {
      throw makeProblem(
        "no-device",
        "Spotify has not made Aura Player available as a device yet.",
        "Wait for the device indicator to show Ready, then try again.",
      );
    }
    return this.status.deviceId;
  }

  private async requestSpotify(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const token = await this.options.getOAuthToken();
    const response = await this.fetchImplementation(
      `https://api.spotify.com/v1${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );

    if (!response.ok) {
      const problem = await mapSpotifyResponseProblem(response);
      this.setStatus({ phase: "error", problem });
      throw problem;
    }

    return response;
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
    this.listeners.forEach((listener) => listener(this.currentState));
  }

  private readonly handleOnline = (): void => {
    this.recoverConnection();
  };

  private readonly handleOffline = (): void => {
    if (!this.player || this.disposed) {
      return;
    }
    if (this.status.problem?.recoverable === false) {
      this.freezeCurrentState();
      this.setStatus({
        phase: this.status.phase,
        deviceId: null,
      });
      return;
    }
    this.enterUnavailableState(
      "offline",
      makeProblem(
        "network",
        "Aura Player is offline.",
        "Playback state will refresh when the network returns.",
      ),
    );
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      void this.refreshState();
    }
  };

  private readonly handleNativeRecoverySignal = (
    signal: RecoverySignal,
  ): void => {
    if (!this.player || this.disposed) {
      return;
    }

    if (signal.kind === "network") {
      if (signal.online) {
        this.recoverConnection();
      } else {
        this.handleOffline();
      }
      return;
    }

    if (signal.event === "suspend") {
      this.stopHeartbeat();
      if (this.status.problem?.recoverable === false) {
        this.freezeCurrentState();
        this.setStatus({
          phase: this.status.phase,
          deviceId: null,
        });
      } else {
        this.enterUnavailableState("reconnecting", null);
      }
      return;
    }

    if (signal.event === "lock-screen") {
      this.stopHeartbeat();
      return;
    }

    this.startHeartbeat();
    if (!signal.state.online) {
      this.handleOffline();
      return;
    }

    this.recoverConnection();
  };

  private attachRecoveryListeners(): void {
    if (this.recoveryListenersAttached || typeof window === "undefined") {
      return;
    }
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    const recoveryApi = (
      window as typeof window & { aura?: AuraDesktopApi }
    ).aura?.recovery;
    if (recoveryApi) {
      this.nativeRecoveryUnsubscribe = recoveryApi.onSignal(
        this.handleNativeRecoverySignal,
      );
      void recoveryApi
        .getState()
        .then((state) => {
          if (!state.online) {
            this.handleOffline();
          }
        })
        .catch(() => {
          // Browser online/offline events and the heartbeat remain available
          // if native state cannot be queried during teardown or reload.
        });
    }
    this.recoveryListenersAttached = true;
  }

  private detachRecoveryListeners(): void {
    if (!this.recoveryListenersAttached || typeof window === "undefined") {
      return;
    }
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.nativeRecoveryUnsubscribe?.();
    this.nativeRecoveryUnsubscribe = null;
    this.recoveryListenersAttached = false;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeat = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const sleptOrStalled = now - this.lastHeartbeat > 75_000;
      this.lastHeartbeat = now;
      if (sleptOrStalled && this.player && navigator.onLine) {
        this.recoverConnection();
      }
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private recoverConnection(): void {
    const player = this.player;
    if (
      !player ||
      this.disposed ||
      this.recoveryPromise ||
      this.status.problem?.recoverable === false
    ) {
      return;
    }

    const generation = this.lifecycleGeneration;
    this.enterUnavailableState("reconnecting", null);
    const recovery = player
      .connect()
      .then((connected) => {
        if (
          !this.isCurrentLifecycle(generation) ||
          this.player !== player
        ) {
          return;
        }
        if (!connected) {
          throw new Error("Spotify declined the recovery connection.");
        }
      })
      .catch((cause: unknown) => {
        if (
          !this.isCurrentLifecycle(generation) ||
          this.player !== player
        ) {
          return;
        }
        const online = navigator.onLine;
        this.setStatus({
          phase: online ? "reconnecting" : "offline",
          problem: makeProblem(
            "network",
            online
              ? "Aura Player is still reconnecting to Spotify."
              : "Aura Player is offline.",
            online
              ? "Keep the app open while it reconnects."
              : "Playback state will refresh when the network returns.",
            cause,
          ),
        });
      })
      .finally(() => {
        if (this.recoveryPromise === recovery) {
          this.recoveryPromise = null;
        }
      });
    this.recoveryPromise = recovery;
  }
}

function isSpotifyState(value: unknown): value is SpotifySdkState {
  if (
    !isRecord(value) ||
    typeof value.paused !== "boolean" ||
    !isNonnegativeFiniteNumber(value.position) ||
    !isNonnegativeFiniteNumber(value.duration) ||
    !isOptionalBoolean(value.loading) ||
    !isOptionalBoolean(value.shuffle) ||
    !isOptionalRepeatMode(value.repeat_mode) ||
    !isSpotifyContext(value.context) ||
    !isSpotifyRestrictions(value.disallows) ||
    !isRecord(value.track_window)
  ) {
    return false;
  }

  return isSpotifyTrack(value.track_window.current_track);
}

function isSpotifyTrack(value: unknown): value is SpotifySdkTrack {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    isNonemptyString(value.uri) &&
    isNonemptyString(value.name) &&
    isNonnegativeFiniteNumber(value.duration_ms) &&
    Array.isArray(value.artists) &&
    value.artists.length > 0 &&
    value.artists.every(
      (artist) =>
        isRecord(artist) && isNonemptyString(artist.name),
    ) &&
    isSpotifyAlbum(value.album)
  );
}

function isSpotifyAlbum(
  value: unknown,
): value is SpotifySdkTrack["album"] {
  return (
    isRecord(value) &&
    isNonemptyString(value.name) &&
    (value.uri === undefined || isNonemptyString(value.uri)) &&
    (value.images === undefined ||
      (Array.isArray(value.images) &&
        value.images.every(isSpotifyImage)))
  );
}

function isSpotifyImage(value: unknown): value is SpotifySdkImage {
  return (
    isRecord(value) &&
    isNonemptyString(value.url) &&
    (value.width === undefined ||
      isNonnegativeFiniteNumber(value.width)) &&
    (value.height === undefined ||
      isNonnegativeFiniteNumber(value.height))
  );
}

function isSpotifyContext(
  value: unknown,
): value is SpotifySdkState["context"] {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.uri === undefined || isNonemptyString(value.uri)))
  );
}

function isSpotifyRestrictions(
  value: unknown,
): value is SpotifySdkState["disallows"] {
  return (
    value === undefined ||
    (isRecord(value) &&
      Object.values(value).every(
        (restriction) => typeof restriction === "boolean",
      ))
  );
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalRepeatMode(
  value: unknown,
): value is 0 | 1 | 2 | undefined {
  return (
    value === undefined ||
    value === 0 ||
    value === 1 ||
    value === 2
  );
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mapRestrictions(
  disallows: Record<string, boolean> | undefined,
): PlaybackRestrictions | undefined {
  if (!disallows) {
    return undefined;
  }

  return {
    pausing: Boolean(disallows.pausing),
    resuming: Boolean(disallows.resuming),
    seeking: Boolean(disallows.seeking),
    skippingNext: Boolean(disallows.skipping_next),
    skippingPrevious: Boolean(disallows.skipping_prev),
  };
}

async function mapSpotifyResponseProblem(
  response: Response,
): Promise<PlaybackProblem> {
  let serverMessage: string | undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      serverMessage =
        typeof body.error.message === "string"
          ? body.error.message
          : undefined;
    }
  } catch {
    // A status and action are still available when the response has no JSON.
  }

  if (response.status === 401) {
    return makeProblem(
      "authentication",
      serverMessage ?? "Spotify authorization expired.",
      "Sign in to Spotify again.",
    );
  }
  if (response.status === 403) {
    return makeProblem(
      "premium-required",
      serverMessage ?? "Spotify rejected this playback action.",
      "Confirm the account has Premium and the requested scope.",
    );
  }
  if (response.status === 404) {
    return makeProblem(
      "no-device",
      serverMessage ?? "No active Spotify device is available.",
      "Choose Aura Player from Available Devices, then try again.",
    );
  }
  if (response.status === 429) {
    return makeProblem(
      "rate-limited",
      serverMessage ?? "Spotify is temporarily rate limiting requests.",
      `Try again${
        response.headers.get("Retry-After")
          ? ` in ${response.headers.get("Retry-After")} seconds`
          : " shortly"
      }.`,
    );
  }

  return makeProblem(
    "playback",
    serverMessage ?? `Spotify playback failed (${response.status}).`,
    "Try another track or device.",
  );
}
