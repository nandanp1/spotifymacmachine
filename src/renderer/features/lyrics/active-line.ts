import type { LyricsLine } from "./types";

/**
 * Positive offset delays the lyrics: a line marked 10,000 ms becomes active at
 * playback position 10,000 + offsetMs. Negative values make lyrics earlier.
 */
export function getActiveLyricIndex(
  lines: readonly LyricsLine[],
  positionMs: number,
  offsetMs = 0,
): number {
  if (!lines.length || !Number.isFinite(positionMs)) {
    return -1;
  }

  const effectivePosition = positionMs - (Number.isFinite(offsetMs) ? offsetMs : 0);
  let lower = 0;
  let upper = lines.length - 1;
  let candidate = -1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const line = lines[middle];
    if (!line) {
      break;
    }
    if (line.startMs <= effectivePosition) {
      candidate = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  if (candidate < 0) {
    return -1;
  }

  const candidateLine = lines[candidate];
  if (!candidateLine) {
    return -1;
  }
  const explicitEnd = candidateLine.endMs;
  if (
    explicitEnd !== undefined &&
    explicitEnd > candidateLine.startMs &&
    effectivePosition >= explicitEnd
  ) {
    return -1;
  }

  return candidate;
}

export const findActiveLyricLineIndex = getActiveLyricIndex;

export interface ActiveLyricsWindow {
  activeIndex: number;
  startIndex: number;
  endIndex: number;
  lines: readonly LyricsLine[];
}

export function getActiveLyricsWindow(
  lines: readonly LyricsLine[],
  positionMs: number,
  options: {
    offsetMs?: number;
    linesBefore?: number;
    linesAfter?: number;
  } = {},
): ActiveLyricsWindow {
  const activeIndex = getActiveLyricIndex(
    lines,
    positionMs,
    options.offsetMs,
  );
  const anchor = activeIndex < 0 ? 0 : activeIndex;
  const startIndex = Math.max(0, anchor - (options.linesBefore ?? 2));
  const endIndex = Math.min(
    lines.length,
    anchor + (options.linesAfter ?? 2) + 1,
  );
  return {
    activeIndex,
    startIndex,
    endIndex,
    lines: lines.slice(startIndex, endIndex),
  };
}
