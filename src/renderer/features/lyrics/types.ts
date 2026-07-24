import type { LyricsTrackIdentity } from "../../../shared/types";

export type TrackIdentity = LyricsTrackIdentity;

export interface LyricsLine {
  startMs: number;
  endMs?: number;
  text: string;
  instrumental?: boolean;
}

/** Backward-compatible descriptive name used by the renderer components. */
export type SyncedLyricLine = LyricsLine;

export type LyricsResult =
  | {
      kind: "synced";
      source: string;
      lines: LyricsLine[];
    }
  | {
      kind: "plain";
      source: string;
      text: string;
    };

export interface LyricsProvider {
  readonly id?: string;
  findLyrics(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null>;
}

export type LyricsProblemCode =
  | "not-configured"
  | "permission-required"
  | "invalid-source"
  | "robots-denied"
  | "rate-limited"
  | "network"
  | "parse"
  | "unknown";

export class LyricsProviderError extends Error {
  readonly code: LyricsProblemCode;
  readonly providerId: string;
  readonly recoverable: boolean;
  override readonly cause?: unknown;

  constructor(options: {
    code: LyricsProblemCode;
    providerId: string;
    message: string;
    recoverable?: boolean;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "LyricsProviderError";
    this.code = options.code;
    this.providerId = options.providerId;
    this.recoverable = options.recoverable ?? true;
    this.cause = options.cause;
  }
}
