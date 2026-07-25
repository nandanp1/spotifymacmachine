import { describe, expect, it } from "vitest";

import {
  LRCLIB_MAX_RESPONSE_BYTES,
  MAX_LRC_FILE_BYTES,
} from "../../src/shared/constants";
import {
  importedLrcFileSchema,
  importedLrcIdRequestSchema,
  lrclibCancelRequestSchema,
  lrclibLookupCancelResultSchema,
  lrclibLookupRequestSchema,
  lrclibLyricsLookupResultSchema,
  lyricsImportRequestSchema,
  lyricsMatchRequestSchema,
} from "../../src/shared/schemas";

const track = {
  spotifyTrackId: "0123456789ABCDEFGHIJKL",
  title: "Borrowed Light",
  artist: "Aura Test Ensemble",
  album: "Original Fixtures",
  durationMs: 182_000,
  isrc: "USAAA2600001",
};

describe("imported lyrics IPC schemas", () => {
  it("accepts a strict import payload with validated track identity", () => {
    expect(
      lyricsImportRequestSchema.parse({ track }),
    ).toEqual({ track });
    expect(
      lyricsMatchRequestSchema.parse({ track }),
    ).toEqual({ track });
  });

  it("rejects unknown fields and malformed identity values", () => {
    expect(
      lyricsImportRequestSchema.safeParse({
        track,
        rawPath: "/tmp/private.lrc",
      }).success,
    ).toBe(false);
    expect(
      lyricsMatchRequestSchema.safeParse({
        track: {
          ...track,
          isrc: "not-an-isrc",
        },
      }).success,
    ).toBe(false);
  });

  it("allows only exact hash IDs", () => {
    expect(
      importedLrcIdRequestSchema.safeParse({
        id: "a".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      importedLrcIdRequestSchema.safeParse({
        id: "../" + "a".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("validates renderer-facing file records without accepting extras", () => {
    const file = {
      id: "a".repeat(64),
      fileName: "Borrowed Light.lrc",
      content: "[00:01.00]An original line",
      sizeBytes: 30,
      importedAt: "2026-07-24T12:00:00.000Z",
      ...track,
    };

    expect(importedLrcFileSchema.safeParse(file).success).toBe(true);
    expect(
      importedLrcFileSchema.safeParse({
        ...file,
        sizeBytes: MAX_LRC_FILE_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      importedLrcFileSchema.safeParse({
        ...file,
        sourcePath: "/private/source.lrc",
      }).success,
    ).toBe(false);
  });
});

describe("LRCLIB lyrics IPC schemas", () => {
  const requestId = "01234567-89ab-4def-8123-456789abcdef";

  it("accepts only strict lookup and cancellation payloads", () => {
    expect(
      lrclibLookupRequestSchema.parse({ requestId, track }),
    ).toEqual({ requestId, track });
    expect(lrclibCancelRequestSchema.parse({ requestId })).toEqual({
      requestId,
    });

    expect(
      lrclibLookupRequestSchema.safeParse({
        requestId,
        track,
        url: "https://unapproved.example/lyrics",
      }).success,
    ).toBe(false);
    expect(
      lrclibLookupRequestSchema.safeParse({
        requestId: "not-a-uuid",
        track,
      }).success,
    ).toBe(false);
    expect(
      lrclibLookupRequestSchema.safeParse({
        requestId,
        track: { ...track, durationMs: 0 },
      }).success,
    ).toBe(false);
    expect(
      lrclibLookupRequestSchema.safeParse({
        requestId,
        track: { ...track, album: undefined },
      }).success,
    ).toBe(false);
    expect(
      lrclibLookupRequestSchema.safeParse({
        requestId,
        track: { ...track, title: "Borrowed Light\naccess-token" },
      }).success,
    ).toBe(false);
    expect(
      lrclibCancelRequestSchema.safeParse({
        requestId,
        cancelAll: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      status: "found",
      provider: "lrclib",
      format: "lrc",
      content: "[00:01.00]An original synchronized line",
    },
    {
      status: "found",
      provider: "lrclib",
      format: "plain",
      content: "An original plain line",
    },
    { status: "not-found", provider: "lrclib" },
    { status: "instrumental", provider: "lrclib" },
    { status: "disabled", provider: "lrclib" },
    {
      status: "rate-limited",
      provider: "lrclib",
      retryAfterMs: 60_000,
    },
    { status: "error", provider: "lrclib", code: "network" },
    { status: "error", provider: "lrclib", code: "timeout" },
    { status: "error", provider: "lrclib", code: "invalid-response" },
  ])("accepts the renderer-facing result variant: $status", (result) => {
    expect(lrclibLyricsLookupResultSchema.parse(result)).toEqual(result);
  });

  it("bounds and strictly validates lookup results", () => {
    expect(
      lrclibLyricsLookupResultSchema.safeParse({
        status: "found",
        provider: "lrclib",
        format: "lrc",
        content: "",
      }).success,
    ).toBe(false);
    expect(
      lrclibLyricsLookupResultSchema.safeParse({
        status: "found",
        provider: "lrclib",
        format: "lrc",
        content: "x".repeat(LRCLIB_MAX_RESPONSE_BYTES + 1),
      }).success,
    ).toBe(false);
    expect(
      lrclibLyricsLookupResultSchema.safeParse({
        status: "rate-limited",
        provider: "lrclib",
        retryAfterMs: 60 * 60 * 1_000 + 1,
      }).success,
    ).toBe(false);
    expect(
      lrclibLyricsLookupResultSchema.safeParse({
        status: "error",
        provider: "lrclib",
        code: "upstream-secret",
      }).success,
    ).toBe(false);
    expect(
      lrclibLyricsLookupResultSchema.safeParse({
        status: "not-found",
        provider: "lrclib",
        diagnostic: "must-not-cross-the-bridge",
      }).success,
    ).toBe(false);
    expect(
      lrclibLyricsLookupResultSchema.safeParse({
        status: "disabled",
        provider: "another-provider",
      }).success,
    ).toBe(false);
  });

  it("accepts strict cancellation results only", () => {
    expect(lrclibLookupCancelResultSchema.parse({ cancelled: true })).toEqual({
      cancelled: true,
    });
    expect(lrclibLookupCancelResultSchema.parse({ cancelled: false })).toEqual({
      cancelled: false,
    });
    expect(
      lrclibLookupCancelResultSchema.safeParse({
        cancelled: true,
        requestId,
      }).success,
    ).toBe(false);
  });
});
