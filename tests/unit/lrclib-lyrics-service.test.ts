import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LrclibLyricsService,
  type LrclibLyricsOutcome,
} from "../../src/main/lrclib-lyrics-service";
import type { LyricsTrackIdentity } from "../../src/shared/types";

const track: LyricsTrackIdentity = {
  spotifyTrackId: "spotify-track-original",
  title: "Borrowed Light",
  artist: "North Window",
  album: "Original Rooms",
  durationMs: 203_400,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("LRCLIB lyrics service", () => {
  it("uses the exact endpoint, primary metadata, duration seconds, and client header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(validRecord()),
    );
    const service = new LrclibLyricsService({ fetchImpl });

    await expect(service.lookup(track)).resolves.toEqual({
      status: "found",
      provider: "lrclib",
      source: "LRCLIB",
      recordId: 42,
      syncedLyrics:
        "[00:01.00]An original first line\n[00:04.00]An original second line",
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [rawUrl, init] = fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    expect(`${url.origin}${url.pathname}`).toBe("https://lrclib.net/api/get");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      track_name: track.title,
      artist_name: track.artist,
      album_name: track.album,
      duration: "203",
    });
    expect(init).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: expect.objectContaining({
        Accept: "application/json",
        "Lrclib-Client": expect.stringContaining("Aura Player"),
      }),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects invalid lookup metadata without making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new LrclibLyricsService({ fetchImpl });

    await expect(
      service.lookup({ ...track, album: undefined }),
    ).resolves.toEqual({
      status: "invalid-track",
      provider: "lrclib",
      reason: "invalid-metadata",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates returned title, artist, and duration before exposing lyrics", async () => {
    const mismatches = [
      validRecord({ trackName: "Another Track" }),
      validRecord({ artistName: "Another Artist" }),
      validRecord({ albumName: "Another Album" }),
      validRecord({ duration: 207 }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(mismatches.shift()),
    );
    const service = new LrclibLyricsService({ fetchImpl });

    for (let index = 0; index < 4; index += 1) {
      await expect(
        service.lookup({
          ...track,
          spotifyTrackId: `spotify-track-${index}`,
        }),
      ).resolves.toEqual({
        status: "malformed-response",
        provider: "lrclib",
        reason: "identity-mismatch",
      });
    }
  });

  it("handles 404 misses and instrumental records as cacheable outcomes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse(
          validRecord({
            id: 43,
            trackName: "Instrumental Room",
            instrumental: true,
            plainLyrics: null,
            syncedLyrics: null,
          }),
        ),
      );
    const service = new LrclibLyricsService({
      fetchImpl,
      sleep: immediateSleep(),
    });
    const instrumentalTrack = {
      ...track,
      spotifyTrackId: "spotify-instrumental",
      title: "Instrumental Room",
    };

    await expect(service.lookup(track)).resolves.toEqual({
      status: "not-found",
      provider: "lrclib",
    });
    await expect(service.lookup(track)).resolves.toEqual({
      status: "not-found",
      provider: "lrclib",
    });
    await expect(service.lookup(instrumentalTrack)).resolves.toEqual({
      status: "instrumental",
      provider: "lrclib",
      source: "LRCLIB",
      recordId: 43,
    });
    await expect(service.lookup(instrumentalTrack)).resolves.toMatchObject({
      status: "instrumental",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces identical in-flight requests while preserving independent caller cancellation", async () => {
    const response = deferred<Response>();
    let fetchSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      fetchSignal = init?.signal ?? undefined;
      return response.promise;
    });
    const service = new LrclibLyricsService({ fetchImpl });
    const firstController = new AbortController();
    const first = service.lookup(track, firstController.signal);
    const second = service.lookup(track);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSignal?.aborted).toBe(false);

    response.resolve(jsonResponse(validRecord()));
    await expect(second).resolves.toMatchObject({ status: "found" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not repopulate a cleared cache from an older in-flight response", async () => {
    const firstResponse = deferred<Response>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => firstResponse.promise)
      .mockImplementationOnce(async () => jsonResponse(validRecord()));
    const service = new LrclibLyricsService({
      fetchImpl,
      sleep: immediateSleep(),
    });
    const firstLookup = service.lookup(track);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    service.clearCache();
    firstResponse.resolve(jsonResponse(validRecord()));
    await expect(firstLookup).resolves.toMatchObject({ status: "found" });

    await expect(service.lookup(track)).resolves.toMatchObject({
      status: "found",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts the underlying request when its only caller cancels", async () => {
    let fetchSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal ?? undefined;
          fetchSignal?.addEventListener(
            "abort",
            () => reject(fetchSignal?.reason),
            { once: true },
          );
        }),
    );
    const service = new LrclibLyricsService({ fetchImpl });
    const controller = new AbortController();
    const lookup = service.lookup(track, controller.signal);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();

    await expect(lookup).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("times out a network request after eight seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const service = new LrclibLyricsService({ fetchImpl });
    const lookup = service.lookup(track);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(lookup).resolves.toEqual({
      status: "network-error",
      provider: "lrclib",
      reason: "timeout",
    });
  });

  it("serializes new network requests and leaves at least 250 ms between them", async () => {
    let now = 0;
    const starts: number[] = [];
    const waits: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      starts.push(now);
      return new Response(null, { status: 404 });
    });
    const service = new LrclibLyricsService({
      fetchImpl,
      now: () => now,
      sleep: async (milliseconds, signal) => {
        signal.throwIfAborted();
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await Promise.all([
      service.lookup(track),
      service.lookup({
        ...track,
        spotifyTrackId: "spotify-track-second",
        title: "Second Original",
      }),
      service.lookup({
        ...track,
        spotifyTrackId: "spotify-track-third",
        title: "Third Original",
      }),
    ]);

    expect(starts).toEqual([0, 250, 500]);
    expect(waits).toEqual([250, 250]);
  });

  it("honors Retry-After without parking later lookups in a long sleep", async () => {
    let now = 1_000;
    const starts: number[] = [];
    const waits: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        starts.push(now);
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      })
      .mockImplementationOnce(async () => {
        starts.push(now);
        return new Response(null, { status: 404 });
      });
    const service = new LrclibLyricsService({
      fetchImpl,
      now: () => now,
      sleep: async (milliseconds, signal) => {
        signal.throwIfAborted();
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await expect(service.lookup(track)).resolves.toEqual({
      status: "rate-limited",
      provider: "lrclib",
      retryAfterMs: 2_000,
    });
    await expect(service.lookup({
      ...track,
      spotifyTrackId: "spotify-track-after-limit",
      title: "After the Limit",
    })).resolves.toEqual({
      status: "rate-limited",
      provider: "lrclib",
      retryAfterMs: 2_000,
    });

    now = 3_000;
    await expect(service.lookup({
      ...track,
      spotifyTrackId: "spotify-track-after-cooldown",
      title: "After the Cooldown",
    })).resolves.toEqual({
      status: "not-found",
      provider: "lrclib",
    });

    expect(starts).toEqual([1_000, 3_000]);
    expect(waits).toEqual([]);
  });

  it("returns structured network and non-success HTTP failures without retrying", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("socket failed"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const service = new LrclibLyricsService({
      fetchImpl,
      sleep: immediateSleep(),
    });

    await expect(service.lookup(track)).resolves.toEqual({
      status: "network-error",
      provider: "lrclib",
      reason: "network",
    });
    await expect(
      service.lookup({
        ...track,
        spotifyTrackId: "spotify-track-http-error",
        title: "HTTP Error",
      }),
    ).resolves.toEqual({
      status: "network-error",
      provider: "lrclib",
      reason: "http-error",
      httpStatus: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects, oversized bodies, malformed JSON, strict-schema violations, and invalid LRC", async () => {
    const oversized = "x".repeat(1024 * 1024 + 1);
    const malformedCases: Array<Response> = [
      new Response(null, {
        status: 302,
        headers: { Location: "https://elsewhere.example/lyrics" },
      }),
      new Response(oversized),
      new Response("{"),
      jsonResponse({ ...validRecord(), unexpected: true }),
      jsonResponse(validRecord({ syncedLyrics: "Untimed original words" })),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const response = malformedCases.shift();
      if (!response) throw new Error("Missing test response");
      return response;
    });
    const service = new LrclibLyricsService({
      fetchImpl,
      sleep: immediateSleep(),
    });
    const expected: LrclibLyricsOutcome[] = [
      {
        status: "network-error",
        provider: "lrclib",
        reason: "redirect-rejected",
        httpStatus: 302,
      },
      {
        status: "malformed-response",
        provider: "lrclib",
        reason: "body-too-large",
      },
      {
        status: "malformed-response",
        provider: "lrclib",
        reason: "invalid-json",
      },
      {
        status: "malformed-response",
        provider: "lrclib",
        reason: "invalid-schema",
      },
      {
        status: "malformed-response",
        provider: "lrclib",
        reason: "invalid-synced-lyrics",
      },
    ];

    for (const [index, outcome] of expected.entries()) {
      await expect(
        service.lookup({
          ...track,
          spotifyTrackId: `spotify-malformed-${index}`,
        }),
      ).resolves.toEqual(outcome);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(expected.length);
  });

  it("uses bounded LRU and separate success/miss expiration", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (rawUrl) => {
      const searchParams = new URL(String(rawUrl)).searchParams;
      const title = searchParams.get("track_name");
      const albumName = searchParams.get("album_name");
      return title === "Missing Original"
        ? new Response(null, { status: 404 })
        : jsonResponse(
            validRecord({
              trackName: title ?? track.title,
              albumName: albumName ?? track.album ?? "",
            }),
          );
    });
    const service = new LrclibLyricsService({
      fetchImpl,
      now: () => now,
      sleep: immediateSleep(() => {
        now += 250;
      }),
      maxCacheEntries: 2,
      successTtlMs: 1_000,
      missTtlMs: 100,
    });
    const second = { ...track, title: "Second Original", album: "Second Album" };
    const missing = {
      ...track,
      title: "Missing Original",
      album: "Missing Album",
    };

    await service.lookup(track);
    await service.lookup(second);
    await service.lookup(track); // Refresh the first entry's LRU position.
    await service.lookup(missing); // Evicts the second entry.
    await service.lookup(second);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    now += 101;
    await service.lookup(missing);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    await service.lookup(second);
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    now += 1_001;
    await service.lookup(second);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

function validRecord(
  patch: Partial<{
    id: number;
    name: string;
    trackName: string;
    artistName: string;
    albumName: string;
    duration: number;
    instrumental: boolean;
    plainLyrics: string | null;
    syncedLyrics: string | null;
    lyricsfile: string;
  }> = {},
) {
  return {
    id: 42,
    name: track.title,
    trackName: track.title,
    artistName: track.artist,
    albumName: track.album ?? "",
    duration: 203,
    instrumental: false,
    plainLyrics: "An original first line\nAn original second line",
    syncedLyrics:
      "[00:01.00]An original first line\n[00:04.00]An original second line",
    lyricsfile:
      "An ignored upstream representation with no renderer exposure.",
    ...patch,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function immediateSleep(onSleep?: () => void) {
  return async (_milliseconds: number, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    onSleep?.();
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
