import { describe, expect, it } from "vitest";

import { resolveLrclibLookup } from "../../src/renderer/features/lyrics/lrclib";

describe("LRCLIB renderer resolution", () => {
  it("parses synchronized community lyrics without inventing timing", () => {
    const resolved = resolveLrclibLookup(
      {
        status: "found",
        provider: "lrclib",
        format: "lrc",
        content: "[00:01.00]First original line\n[00:03.00]Second original line",
      },
      "Original fixture",
    );

    expect(resolved).toEqual({
      kind: "lyrics",
      lyrics: {
        kind: "synced",
        source: "LRCLIB community sync",
        lines: [
          {
            startMs: 1_000,
            endMs: 3_000,
            text: "First original line",
            instrumental: false,
          },
          {
            startMs: 3_000,
            endMs: undefined,
            text: "Second original line",
            instrumental: false,
          },
        ],
      },
    });
  });

  it("supports plain lyrics while preserving the provider label", () => {
    expect(
      resolveLrclibLookup(
        {
          status: "found",
          provider: "lrclib",
          format: "plain",
          content: "  An original plain lyric  ",
        },
        "Original fixture",
      ),
    ).toEqual({
      kind: "lyrics",
      lyrics: {
        kind: "plain",
        source: "LRCLIB community",
        text: "An original plain lyric",
      },
    });
  });

  it("keeps misses, instrumentals, cooldowns, and failures honest", () => {
    expect(
      resolveLrclibLookup(
        { status: "not-found", provider: "lrclib" },
        "Missing fixture",
      ),
    ).toMatchObject({ kind: "unavailable" });
    expect(
      resolveLrclibLookup(
        { status: "instrumental", provider: "lrclib" },
        "Instrumental fixture",
      ),
    ).toMatchObject({ kind: "unavailable" });
    expect(
      resolveLrclibLookup(
        {
          status: "rate-limited",
          provider: "lrclib",
          retryAfterMs: 61_000,
        },
        "Cooling fixture",
      ),
    ).toEqual({
      kind: "unavailable",
      message:
        "LRCLIB is cooling down. Aura can try this track again in about 2 minutes.",
    });
    expect(
      resolveLrclibLookup(
        {
          status: "error",
          provider: "lrclib",
          code: "invalid-response",
        },
        "Invalid fixture",
      ),
    ).toMatchObject({ kind: "error" });
    expect(
      resolveLrclibLookup(
        { status: "disabled", provider: "lrclib" },
        "Disabled fixture",
      ),
    ).toEqual({ kind: "disabled" });
  });
});
