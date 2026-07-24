import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ImportedLyricsStore } from "../../src/main/lyrics-store";
import { MAX_LRC_FILE_BYTES } from "../../src/shared/constants";
import type { LyricsTrackIdentity } from "../../src/shared/types";

const track: LyricsTrackIdentity = {
  spotifyTrackId: "spotify-track-1",
  title: "Borrowed Light",
  artist: "Aura Test Ensemble",
  album: "Original Fixtures",
  durationMs: 182_000,
  isrc: "USAAA2600001",
};

const originalLrc = [
  "[ti:Borrowed Light]",
  "[ar:Aura Test Ensemble]",
  "[al:Original Fixtures]",
  "[00:01.00]An original persisted line",
].join("\n");

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(
    path.join(tmpdir(), "aura-imported-lyrics-"),
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("ImportedLyricsStore", () => {
  it("persists validated metadata and content across store instances", async () => {
    const importedAt = new Date("2026-07-24T12:00:00.000Z");
    const firstStore = new ImportedLyricsStore(
      directory,
      () => importedAt,
    );
    const saved = await firstStore.save({
      fileName: "Borrowed Light.lrc",
      content: originalLrc,
      track,
    });

    expect(saved).toMatchObject({
      fileName: "Borrowed Light.lrc",
      content: originalLrc,
      sizeBytes: Buffer.byteLength(originalLrc),
      importedAt: importedAt.toISOString(),
      ...track,
    });
    expect(saved.id).toMatch(/^[a-f0-9]{64}$/);
    expect((await readdir(directory)).sort()).toEqual(
      [`${saved.id}.json`, `${saved.id}.lrc`].sort(),
    );

    const restartedStore = new ImportedLyricsStore(directory);
    await expect(restartedStore.list()).resolves.toEqual([
      {
        id: saved.id,
        fileName: "Borrowed Light.lrc",
        sizeBytes: Buffer.byteLength(originalLrc),
        importedAt: importedAt.toISOString(),
        ...track,
      },
    ]);
    await expect(restartedStore.read(saved.id)).resolves.toEqual(saved);
  });

  it("matches by Spotify ID, case-insensitive ISRC, and normalized text", async () => {
    const store = new ImportedLyricsStore(directory);
    const saved = await store.save({
      fileName: "Borrowed Light.lrc",
      content: originalLrc,
      track,
    });

    await expect(
      store.match({
        ...track,
        title: "Unrelated",
        artist: "Someone Else",
      }),
    ).resolves.toMatchObject({ id: saved.id });
    await expect(
      store.match({
        ...track,
        spotifyTrackId: "another-track",
        title: "Unrelated",
        artist: "Someone Else",
        isrc: track.isrc?.toLowerCase(),
      }),
    ).resolves.toMatchObject({ id: saved.id });
    await expect(
      store.match({
        ...track,
        spotifyTrackId: "another-track",
        title: "Borrowed Light (2026 Remastered Version)",
        artist: "Áura Test Ensemble",
        isrc: undefined,
      }),
    ).resolves.toMatchObject({ id: saved.id });
  });

  it("recovers a legacy content-only record from sanitized LRC tags", async () => {
    const id = createHash("sha256")
      .update(originalLrc, "utf8")
      .digest("hex");
    await writeFile(path.join(directory, `${id}.lrc`), originalLrc, {
      encoding: "utf8",
      mode: 0o600,
    });
    const store = new ImportedLyricsStore(directory);

    const records = await store.list();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id,
      title: "Borrowed Light",
      artist: "Aura Test Ensemble",
      album: "Original Fixtures",
    });
    await expect(
      store.match({
        ...track,
        spotifyTrackId: "new-track-id",
        isrc: undefined,
      }),
    ).resolves.toMatchObject({
      id,
      content: originalLrc,
    });
    expect(await readdir(directory)).toContain(`${id}.json`);
  });

  it("deletes only the requested record and reports missing records honestly", async () => {
    const store = new ImportedLyricsStore(directory);
    const saved = await store.save({
      fileName: "Borrowed Light.lrc",
      content: originalLrc,
      track,
    });
    const sentinelPath = path.join(directory, "keep-me.txt");
    await writeFile(sentinelPath, "unrelated local data", "utf8");

    await expect(store.delete(saved.id)).resolves.toEqual({
      deleted: true,
    });
    await expect(store.read(saved.id)).resolves.toBeNull();
    await expect(store.delete(saved.id)).resolves.toEqual({
      deleted: false,
    });
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
      "unrelated local data",
    );
    expect(await readdir(directory)).toEqual(["keep-me.txt"]);
  });

  it("ignores malformed metadata that has no valid local content", async () => {
    const id = "a".repeat(64);
    await writeFile(
      path.join(directory, `${id}.json`),
      JSON.stringify({
        id,
        fileName: "../escape.lrc",
        sizeBytes: -1,
        importedAt: "not-a-date",
      }),
      "utf8",
    );

    await expect(
      new ImportedLyricsStore(directory).list(),
    ).resolves.toEqual([]);
  });

  it("rejects oversized content and traversal-shaped IDs", async () => {
    const store = new ImportedLyricsStore(directory);

    await expect(
      store.save({
        fileName: "oversized.lrc",
        content: "x".repeat(MAX_LRC_FILE_BYTES + 1),
      }),
    ).rejects.toThrow("too large");
    await expect(store.read("../outside")).rejects.toThrow();
    await expect(store.delete("../outside")).rejects.toThrow();
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
