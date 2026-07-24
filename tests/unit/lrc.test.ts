import { describe, expect, it } from "vitest";

import {
  LrcParseError,
  parseLrc,
  parseLrcLyrics,
  parseLrcTimestamp,
} from "../../src/renderer/features/lyrics/lrc";

describe("LRC timestamp parsing", () => {
  it.each([
    ["00:07", 7_000],
    ["01:02.34", 62_340],
    ["[03:04.005]", 184_005],
    ["1:02:03.004", 3_723_004],
  ])("parses %s as %i ms", (timestamp, expected) => {
    expect(parseLrcTimestamp(timestamp)).toBe(expected);
  });

  it.each(["", "hello", "00:60.00", "[00:01.00] trailing"])(
    "rejects malformed timestamp %s",
    (timestamp) => {
      expect(parseLrcTimestamp(timestamp)).toBeNull();
    },
  );
});

describe("LRC document parsing", () => {
  it("reads metadata, applies offsets, sorts lines, and derives end times", () => {
    const document = parseLrc(
      [
        "\uFEFF[ti:Borrowed Light]",
        "[ar:Aura Test Ensemble]",
        "[al:Original Fixtures]",
        "[offset:120]",
        "[00:08.50]Second original line",
        "[00:03.00][00:05.00]First original line",
      ].join("\r\n"),
      { additionalOffsetMs: -20 },
    );

    expect(document.metadata).toMatchObject({
      title: "Borrowed Light",
      artist: "Aura Test Ensemble",
      album: "Original Fixtures",
      offsetMs: 120,
    });
    expect(document.lines).toEqual([
      {
        startMs: 3_100,
        endMs: 5_100,
        text: "First original line",
        instrumental: false,
      },
      {
        startMs: 5_100,
        endMs: 8_600,
        text: "First original line",
        instrumental: false,
      },
      {
        startMs: 8_600,
        endMs: undefined,
        text: "Second original line",
        instrumental: false,
      },
    ]);
    expect(document.warnings).toEqual([]);
  });

  it("keeps timed blank lines as instrumental sections by default", () => {
    const document = parseLrc("[00:01.00]\n[00:02.00]A quiet return");

    expect(document.lines[0]).toMatchObject({
      startMs: 1_000,
      text: "",
      instrumental: true,
    });
    expect(document.lines[1]).toMatchObject({
      startMs: 2_000,
      text: "A quiet return",
      instrumental: false,
    });
  });

  it("removes inline word timestamps and duplicate lines", () => {
    const document = parseLrc(
      [
        "[00:02.00]<00:02.00>Hold <00:02.40>the horizon",
        "[00:02.00]Hold the horizon",
      ].join("\n"),
    );

    expect(document.lines).toHaveLength(1);
    expect(document.lines[0]).toMatchObject({
      startMs: 2_000,
      text: "Hold the horizon",
    });
  });

  it("reports a useful error when no synchronized lines exist", () => {
    const document = parseLrc("[ti:Untimed]\nOriginal placeholder text");

    expect(document.lines).toEqual([]);
    expect(document.warnings).toContain(
      "No synchronized lyric timestamps were found.",
    );
    expect(() => parseLrcLyrics("[ti:Untimed]")).toThrow(LrcParseError);
  });
});
