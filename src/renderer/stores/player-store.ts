"use client";

import { useSyncExternalStore } from "react";
import {
  estimatePlaybackPosition,
  type ObservablePlaybackService,
  type PlaybackConnectionPhase,
  type PlaybackProblem,
  type PlaybackRestrictions,
  type PlaybackService,
  type PlaybackServiceStatus,
  type PlayerState,
  type PlayerTrack,
} from "../features/player/playback-service";

export interface AuraTrack {
  id: string;
  uri: string;
  title: string;
  artist: string;
  artists?: string[];
  album: string;
  artworkUrl?: string | null;
  durationMs: number;
  source?: "demo" | "spotify";
}

export interface AuraPlayerState {
  source: "none" | "demo" | "spotify";
  connectionPhase: PlaybackConnectionPhase | "demo";
  track: AuraTrack | null;
  paused: boolean;
  isPlaying: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  deviceId: string | null;
  deviceName: string;
  restrictions?: PlaybackRestrictions;
  problem: PlaybackProblem | null;
  observedAt: number;
}

export interface DemoPlaybackOptions {
  paused?: boolean;
  positionMs?: number;
  volume?: number;
  deviceName?: string;
}

export interface PlayerStoreSnapshot extends AuraPlayerState {
  connect(service: PlaybackService): Promise<void>;
  disconnect(): Promise<void>;
  play(uri?: string): Promise<void>;
  pause(): Promise<void>;
  togglePlayback(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setDemoTrack(track: AuraTrack, options?: DemoPlaybackOptions): void;
  clearDemo(): void;
}

const INITIAL_STATE: AuraPlayerState = {
  source: "none",
  connectionPhase: "idle",
  track: null,
  paused: true,
  isPlaying: false,
  buffering: false,
  positionMs: 0,
  durationMs: 0,
  volume: 0.72,
  deviceId: null,
  deviceName: "Aura Player — Mac",
  restrictions: undefined,
  problem: null,
  observedAt: Date.now(),
};

type StoreListener = () => void;

class AuraPlayerStore {
  private service: PlaybackService | null = null;
  private unsubscribePlayback: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private listeners = new Set<StoreListener>();
  private generation = 0;
  private snapshot: PlayerStoreSnapshot;

  constructor() {
    this.snapshot = this.makeSnapshot(INITIAL_STATE);
  }

  getSnapshot = (): PlayerStoreSnapshot => this.snapshot;

  getState = (): AuraPlayerState => stripActions(this.snapshot);

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  connect = async (service: PlaybackService): Promise<void> => {
    const generation = ++this.generation;
    const previousService = this.service;
    this.detachSubscriptions();
    if (previousService && previousService !== service) {
      try {
        await previousService.disconnect();
      } catch {
        // The replacement service can still connect; its status will be the
        // canonical error surface from this point forward.
      }
      if (generation !== this.generation) {
        return;
      }
    }
    this.service = service;
    this.patch({
      source: "spotify",
      connectionPhase: "connecting",
      track: null,
      paused: true,
      isPlaying: false,
      buffering: true,
      positionMs: 0,
      durationMs: 0,
      restrictions: undefined,
      problem: null,
      observedAt: Date.now(),
    });

    this.unsubscribePlayback = service.subscribe((state) => {
      if (generation === this.generation) {
        this.receivePlaybackState(state);
      }
    });
    if (isObservableService(service)) {
      this.unsubscribeStatus = service.subscribeStatus((status) => {
        if (generation === this.generation) {
          this.receiveServiceStatus(status);
        }
      });
      this.receiveServiceStatus(service.getStatus());
    }

    try {
      await service.connect();
      if (generation !== this.generation) {
        return;
      }
      const state = await service.getState();
      if (generation === this.generation) {
        this.receivePlaybackState(state);
        if (!isObservableService(service)) {
          this.patch({
            connectionPhase: "ready",
            buffering: state?.buffering ?? false,
          });
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.patch({
          connectionPhase: "error",
          buffering: false,
          problem: toPlaybackProblem(error),
        });
      }
      throw error;
    }
  };

  disconnect = async (): Promise<void> => {
    ++this.generation;
    const service = this.service;
    this.service = null;
    this.detachSubscriptions();
    try {
      if (service) {
        await service.disconnect();
      }
    } finally {
      this.patch({ ...INITIAL_STATE, observedAt: Date.now() });
    }
  };

  play = async (uri?: string): Promise<void> => {
    if (this.snapshot.source === "demo") {
      this.patch({
        paused: false,
        isPlaying: true,
        observedAt: Date.now(),
        problem: null,
      });
      return;
    }
    await this.runServiceAction((service) => service.play(uri));
  };

  pause = async (): Promise<void> => {
    if (this.snapshot.source === "demo") {
      this.patch({
        positionMs: this.estimatedPosition(),
        paused: true,
        isPlaying: false,
        observedAt: Date.now(),
      });
      return;
    }
    await this.runServiceAction((service) => service.pause());
  };

  togglePlayback = async (): Promise<void> => {
    if (this.snapshot.paused) {
      await this.play();
    } else {
      await this.pause();
    }
  };

  next = async (): Promise<void> => {
    if (this.snapshot.source === "demo") {
      return;
    }
    await this.runServiceAction((service) => service.next());
  };

  previous = async (): Promise<void> => {
    if (this.snapshot.source === "demo") {
      this.patch({
        positionMs: 0,
        observedAt: Date.now(),
      });
      return;
    }
    await this.runServiceAction((service) => service.previous());
  };

  seek = async (positionMs: number): Promise<void> => {
    const bounded = Math.min(
      Math.max(0, Number.isFinite(positionMs) ? positionMs : 0),
      this.snapshot.durationMs || Number.MAX_SAFE_INTEGER,
    );
    if (this.snapshot.source === "demo") {
      this.patch({
        positionMs: bounded,
        observedAt: Date.now(),
      });
      return;
    }
    await this.runServiceAction((service) => service.seek(bounded));
  };

  setVolume = async (volume: number): Promise<void> => {
    const bounded = Math.min(
      1,
      Math.max(0, Number.isFinite(volume) ? volume : 0),
    );
    if (this.snapshot.source === "demo") {
      this.patch({ volume: bounded });
      return;
    }
    await this.runServiceAction((service) => service.setVolume(bounded));
  };

  setDemoTrack = (
    track: AuraTrack,
    options: DemoPlaybackOptions = {},
  ): void => {
    ++this.generation;
    const previousService = this.service;
    this.service = null;
    this.detachSubscriptions();
    if (previousService) {
      void previousService.disconnect().catch(() => {
        // Demo provenance stays explicit even if Spotify cleanup fails.
      });
    }
    const paused = options.paused ?? false;
    this.patch({
      source: "demo",
      connectionPhase: "demo",
      track: {
        ...track,
        source: "demo",
      },
      paused,
      isPlaying: !paused,
      buffering: false,
      positionMs: clamp(
        options.positionMs ?? 0,
        0,
        track.durationMs,
      ),
      durationMs: track.durationMs,
      volume: clamp(options.volume ?? this.snapshot.volume, 0, 1),
      deviceId: null,
      deviceName: options.deviceName ?? "Design preview — not connected",
      restrictions: undefined,
      problem: null,
      observedAt: Date.now(),
    });
  };

  clearDemo = (): void => {
    if (this.snapshot.source !== "demo") {
      return;
    }
    this.patch({ ...INITIAL_STATE, observedAt: Date.now() });
  };

  private async runServiceAction(
    action: (service: PlaybackService) => Promise<void>,
  ): Promise<void> {
    if (!this.service) {
      const problem: PlaybackProblem = {
        code: "sdk-unavailable",
        message: "Spotify playback is not connected.",
        recoverable: true,
        action: "Connect Aura Player to Spotify first.",
      };
      this.patch({ problem });
      throw problem;
    }

    try {
      await action(this.service);
      // Live state is intentionally not updated optimistically. The selected
      // device's next verified Spotify snapshot remains the source of truth.
    } catch (error) {
      this.patch({ problem: toPlaybackProblem(error) });
      throw error;
    }
  }

  private receivePlaybackState(state: PlayerState | null): void {
    if (
      this.service &&
      isObservableService(this.service) &&
      this.snapshot.connectionPhase !== "ready"
    ) {
      return;
    }
    if (!state) {
      this.patch({
        track: null,
        paused: true,
        isPlaying: false,
        buffering: false,
        positionMs: 0,
        durationMs: 0,
        restrictions: undefined,
        observedAt: Date.now(),
      });
      return;
    }

    this.patch({
      source: "spotify",
      track: state.track ? mapTrack(state.track) : null,
      paused: state.paused,
      isPlaying: !state.paused && !state.buffering,
      buffering: state.buffering,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
      volume: state.volume,
      deviceId: state.deviceId,
      restrictions: state.restrictions
        ? { ...state.restrictions }
        : undefined,
      observedAt: state.observedAt,
    });
  }

  private receiveServiceStatus(status: PlaybackServiceStatus): void {
    const now = Date.now();
    const ready = status.phase === "ready";
    const buffering =
      status.phase === "loading-sdk" ||
      status.phase === "connecting" ||
      status.phase === "reconnecting";
    this.patch({
      connectionPhase: status.phase,
      deviceId: ready ? status.deviceId : null,
      deviceName: status.deviceName,
      restrictions: ready ? this.snapshot.restrictions : undefined,
      problem: status.problem,
      paused: ready ? this.snapshot.paused : true,
      isPlaying: ready ? this.snapshot.isPlaying : false,
      buffering: ready ? this.snapshot.buffering : buffering,
      positionMs: ready
        ? this.snapshot.positionMs
        : getEstimatedAuraPosition(this.snapshot, now),
      observedAt: ready ? this.snapshot.observedAt : now,
    });
  }

  private estimatedPosition(): number {
    return estimatePlaybackPosition({
      source: this.snapshot.source === "spotify" ? "spotify" : "demo",
      track: null,
      paused: this.snapshot.paused,
      buffering: this.snapshot.buffering,
      positionMs: this.snapshot.positionMs,
      durationMs: this.snapshot.durationMs,
      volume: this.snapshot.volume,
      deviceId: this.snapshot.deviceId,
      observedAt: this.snapshot.observedAt,
    });
  }

  private patch(patch: Partial<AuraPlayerState>): void {
    const nextState: AuraPlayerState = {
      ...stripActions(this.snapshot),
      ...patch,
    };
    this.snapshot = this.makeSnapshot(nextState);
    this.listeners.forEach((listener) => listener());
  }

  private makeSnapshot(state: AuraPlayerState): PlayerStoreSnapshot {
    return {
      ...state,
      connect: this.connect,
      disconnect: this.disconnect,
      play: this.play,
      pause: this.pause,
      togglePlayback: this.togglePlayback,
      next: this.next,
      previous: this.previous,
      seek: this.seek,
      setVolume: this.setVolume,
      setDemoTrack: this.setDemoTrack,
      clearDemo: this.clearDemo,
    };
  }

  private detachSubscriptions(): void {
    this.unsubscribePlayback?.();
    this.unsubscribeStatus?.();
    this.unsubscribePlayback = null;
    this.unsubscribeStatus = null;
  }
}

export const playerStore = new AuraPlayerStore();

export function usePlayerStore(): PlayerStoreSnapshot;
export function usePlayerStore<Selected>(
  selector: (state: PlayerStoreSnapshot) => Selected,
): Selected;
export function usePlayerStore<Selected>(
  selector?: (state: PlayerStoreSnapshot) => Selected,
): PlayerStoreSnapshot | Selected {
  const snapshot = useSyncExternalStore(
    playerStore.subscribe,
    playerStore.getSnapshot,
    playerStore.getSnapshot,
  );
  return selector ? selector(snapshot) : snapshot;
}

export function getEstimatedAuraPosition(
  state: AuraPlayerState,
  now = Date.now(),
): number {
  if (
    (state.connectionPhase !== "ready" &&
      state.connectionPhase !== "demo") ||
    state.paused ||
    state.buffering
  ) {
    return state.positionMs;
  }
  return clamp(
    state.positionMs + Math.max(0, now - state.observedAt),
    0,
    state.durationMs,
  );
}

function mapTrack(track: PlayerTrack): AuraTrack {
  const artwork = [...track.artwork].sort(
    (left, right) => (right.width ?? 0) - (left.width ?? 0),
  )[0];
  return {
    id: track.id,
    uri: track.uri,
    title: track.title,
    artist: track.artists.join(", "),
    artists: track.artists,
    album: track.album,
    artworkUrl: artwork?.url ?? null,
    durationMs: track.durationMs,
    source: "spotify",
  };
}

function stripActions(snapshot: PlayerStoreSnapshot): AuraPlayerState {
  return {
    source: snapshot.source,
    connectionPhase: snapshot.connectionPhase,
    track: snapshot.track,
    paused: snapshot.paused,
    isPlaying: snapshot.isPlaying,
    buffering: snapshot.buffering,
    positionMs: snapshot.positionMs,
    durationMs: snapshot.durationMs,
    volume: snapshot.volume,
    deviceId: snapshot.deviceId,
    deviceName: snapshot.deviceName,
    restrictions: snapshot.restrictions,
    problem: snapshot.problem,
    observedAt: snapshot.observedAt,
  };
}

function isObservableService(
  service: PlaybackService,
): service is ObservablePlaybackService {
  return (
    "getStatus" in service &&
    typeof service.getStatus === "function" &&
    "subscribeStatus" in service &&
    typeof service.subscribeStatus === "function"
  );
}

function toPlaybackProblem(error: unknown): PlaybackProblem {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return {
      code:
        typeof error.code === "string"
          ? (error.code as PlaybackProblem["code"])
          : "unknown",
      message: error.message,
      recoverable:
        "recoverable" in error && typeof error.recoverable === "boolean"
          ? error.recoverable
          : true,
      action:
        "action" in error && typeof error.action === "string"
          ? error.action
          : "Try again.",
      cause: error,
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : "Playback failed.",
    recoverable: true,
    action: "Try again.",
    cause: error,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
