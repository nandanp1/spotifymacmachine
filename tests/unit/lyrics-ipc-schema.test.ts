import { describe, expect, it } from "vitest";

import { MAX_LRC_FILE_BYTES } from "../../src/shared/constants";
import {
  importedLrcFileSchema,
  importedLrcIdRequestSchema,
  lyricsImportRequestSchema,
  lyricsMatchRequestSchema,
} from "../../src/shared/schemas";

const track = {
  spotifyTrackId: "spotify-track-1",
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
