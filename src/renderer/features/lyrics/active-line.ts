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

export type LyricsTimelinePhase = "before" | "active" | "gap" | "after";

export interface LyricsTimelineState {
  activeIndex: number;
  anchorIndex: number;
  phase: LyricsTimelinePhase;
  /**
   * Null means the source did not provide enough timing information for a
   * determinate line-progress indicator.
   */
  progress: number | null;
}

/**
 * Describes both the honest timing state and the visual line to keep near the
 * reading axis. Explicit gaps never mark a lyric as current.
 */
export function getLyricsTimelineState(
  lines: readonly LyricsLine[],
  positionMs: number,
  offsetMs = 0,
): LyricsTimelineState {
  if (!lines.length || !Number.isFinite(positionMs)) {
    return {
      activeIndex: -1,
      anchorIndex: -1,
      phase: "before",
      progress: 0,
    };
  }

  const safeOffset = Number.isFinite(offsetMs) ? offsetMs : 0;
  const effectivePosition = positionMs - safeOffset;
  const activeIndex = getActiveLyricIndex(lines, positionMs, safeOffset);

  if (activeIndex >= 0) {
    const line = lines[activeIndex];
    if (!line) {
      return {
        activeIndex: -1,
        anchorIndex: 0,
        phase: "before",
        progress: 0,
      };
    }
    const nextLine = lines[activeIndex + 1];
    const endMs =
      line.endMs !== undefined && line.endMs > line.startMs
        ? line.endMs
        : nextLine && nextLine.startMs > line.startMs
          ? nextLine.startMs
          : null;
    return {
      activeIndex,
      anchorIndex: activeIndex,
      phase: "active",
      progress:
        endMs === null
          ? null
          : clampProgress(
              (effectivePosition - line.startMs) /
                (endMs - line.startMs),
            ),
    };
  }

  const nextIndex = lines.findIndex(
    (line) => line.startMs > effectivePosition,
  );
  if (nextIndex === 0) {
    return {
      activeIndex: -1,
      anchorIndex: 0,
      phase: "before",
      progress: 0,
    };
  }
  if (nextIndex > 0) {
    return {
      activeIndex: -1,
      anchorIndex: nextIndex,
      phase: "gap",
      progress: 0,
    };
  }

  return {
    activeIndex: -1,
    anchorIndex: lines.length - 1,
    phase: "after",
    progress: 1,
  };
}

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

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
