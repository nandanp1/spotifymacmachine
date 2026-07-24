import type { PlayerState } from "../player/playback-service";
import type { VisualMode } from "../../../shared/types";

export interface VisualPalette {
  shadow: string;
  primary: string;
  accent: string;
  highlight: string;
}

export interface VisualTrackContext {
  trackId: string;
  artworkUrl?: string;
  palette?: Partial<VisualPalette>;
}

export type VisualPlaybackState = Pick<
  PlayerState,
  "paused" | "buffering" | "positionMs" | "durationMs" | "observedAt"
>;

export interface VisualEngine {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  setTrack(context: VisualTrackContext): Promise<void>;
  setPlaybackState(state: VisualPlaybackState): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setIntensity(value: number): void;
  setMode(mode: VisualMode): void;
  destroy(): void;
}

export const NOCTURNE_FALLBACK_PALETTE: VisualPalette = {
  shadow: "#08090b",
  primary: "#392b48",
  accent: "#d46f62",
  highlight: "#e5bd80",
};

export function hashTrackId(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
