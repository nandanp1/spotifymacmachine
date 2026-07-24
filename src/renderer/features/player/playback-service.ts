export type PlaybackSource = "demo" | "spotify";

export interface ArtworkImage {
  url: string;
  width?: number;
  height?: number;
}

export interface PlayerTrack {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  album: string;
  albumUri?: string;
  durationMs: number;
  artwork: ArtworkImage[];
  isPlayable?: boolean;
}

export interface PlaybackRestrictions {
  pausing?: boolean;
  resuming?: boolean;
  seeking?: boolean;
  skippingNext?: boolean;
  skippingPrevious?: boolean;
}

export interface PlayerState {
  /**
   * Provenance is intentionally part of state so a demo can never be mistaken
   * for a successful Spotify connection.
   */
  source: PlaybackSource;
  track: PlayerTrack | null;
  paused: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  deviceId: string | null;
  contextUri?: string;
  repeatMode?: "off" | "context" | "track";
  shuffle?: boolean;
  restrictions?: PlaybackRestrictions;
  /** Epoch milliseconds at which positionMs was observed. */
  observedAt: number;
}

export type PlaybackConnectionPhase =
  | "idle"
  | "loading-sdk"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "offline"
  | "unavailable"
  | "error";

export type PlaybackErrorCode =
  | "authentication"
  | "premium-required"
  | "sdk-unavailable"
  | "initialization"
  | "account"
  | "playback"
  | "network"
  | "rate-limited"
  | "no-device"
  | "transfer-rejected"
  | "track-unavailable"
  | "unknown";

export interface PlaybackProblem {
  code: PlaybackErrorCode;
  message: string;
  recoverable: boolean;
  action?: string;
  cause?: unknown;
}

export interface PlaybackServiceStatus {
  phase: PlaybackConnectionPhase;
  deviceId: string | null;
  deviceName: string;
  problem: PlaybackProblem | null;
}

export interface PlaybackService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  play(uri?: string): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getState(): Promise<PlayerState | null>;
  subscribe(listener: (state: PlayerState | null) => void): () => void;
}

/**
 * Services with a real connection lifecycle should expose status separately
 * from playback. This prevents a null song from being interpreted as an error.
 */
export interface ObservablePlaybackService extends PlaybackService {
  getStatus(): PlaybackServiceStatus;
  subscribeStatus(
    listener: (status: PlaybackServiceStatus) => void,
  ): () => void;
}

export function clampPosition(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs)) {
    return 0;
  }

  const upperBound =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : Number.MAX_SAFE_INTEGER;

  return Math.min(Math.max(0, positionMs), upperBound);
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }

  return Math.min(1, Math.max(0, volume));
}

export function estimatePlaybackPosition(
  state: PlayerState,
  now = Date.now(),
): number {
  if (state.paused || state.buffering) {
    return clampPosition(state.positionMs, state.durationMs);
  }

  return clampPosition(
    state.positionMs + Math.max(0, now - state.observedAt),
    state.durationMs,
  );
}
