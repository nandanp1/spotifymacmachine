import { describe, expect, it } from "vitest";

import {
  getActiveLyricIndex,
  getActiveLyricsWindow,
  getLyricsTimelineState,
} from "../../src/renderer/features/lyrics/active-line";
import type { LyricsLine } from "../../src/renderer/features/lyrics/types";

const lines: LyricsLine[] = [
  { startMs: 1_000, endMs: 2_000, text: "A silver morning" },
  { startMs: 3_000, text: "Across the glass" },
  { startMs: 5_000, endMs: 6_000, text: "The room turns gold" },
  { startMs: 8_000, text: "And settles softly" },
];

describe("active lyric selection", () => {
  it.each([
    [0, -1],
    [999, -1],
    [1_000, 0],
    [1_999, 0],
    [2_000, -1],
    [3_000, 1],
    [7_999, -1],
    [8_000, 3],
  ])("selects index %i at %i ms", (positionMs, expectedIndex) => {
    expect(getActiveLyricIndex(lines, positionMs)).toBe(expectedIndex);
  });

  it("delays lyrics for a positive offset and advances them for a negative one", () => {
    expect(getActiveLyricIndex(lines, 1_400, 500)).toBe(-1);
    expect(getActiveLyricIndex(lines, 1_500, 500)).toBe(0);
    expect(getActiveLyricIndex(lines, 2_500, -500)).toBe(1);
  });

  it("returns no active line for empty data or a non-finite position", () => {
    expect(getActiveLyricIndex([], 1_000)).toBe(-1);
    expect(getActiveLyricIndex(lines, Number.NaN)).toBe(-1);
  });

  it("returns a bounded window around the active line", () => {
    expect(
      getActiveLyricsWindow(lines, 5_500, {
        linesBefore: 1,
        linesAfter: 1,
      }),
    ).toEqual({
      activeIndex: 2,
      startIndex: 1,
      endIndex: 4,
      lines: lines.slice(1, 4),
    });
  });

  it("reports line progress without pretending explicit gaps are active", () => {
    expect(getLyricsTimelineState(lines, 1_500)).toEqual({
      activeIndex: 0,
      anchorIndex: 0,
      phase: "active",
      progress: 0.5,
    });
    expect(getLyricsTimelineState(lines, 2_500)).toEqual({
      activeIndex: -1,
      anchorIndex: 1,
      phase: "gap",
      progress: 0,
    });
  });

  it("applies offsets without inventing final-line timing", () => {
    expect(getLyricsTimelineState(lines, 3_500, 500)).toMatchObject({
      activeIndex: 1,
      phase: "active",
      progress: 0,
    });
    expect(getLyricsTimelineState(lines, 20_000)).toEqual({
      activeIndex: 3,
      anchorIndex: 3,
      phase: "active",
      progress: null,
    });
  });

  it("distinguishes before, after, empty, and invalid timelines", () => {
    expect(getLyricsTimelineState(lines, 500)).toMatchObject({
      activeIndex: -1,
      anchorIndex: 0,
      phase: "before",
    });
    expect(
      getLyricsTimelineState(
        [{ startMs: 1_000, endMs: 2_000, text: "A short coda" }],
        2_500,
      ),
    ).toEqual({
      activeIndex: -1,
      anchorIndex: 0,
      phase: "after",
      progress: 1,
    });
    expect(getLyricsTimelineState([], 1_000)).toMatchObject({
      activeIndex: -1,
      anchorIndex: -1,
      phase: "before",
    });
    expect(getLyricsTimelineState(lines, Number.NaN)).toMatchObject({
      activeIndex: -1,
      anchorIndex: -1,
      phase: "before",
    });
  });
});
