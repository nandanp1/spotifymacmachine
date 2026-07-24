// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthorizedScraperProvider,
  AuthorizedSourceTransportError,
  LicensedLyricsProvider,
  LocalLrcProvider,
  LyricsProviderChain,
  normalizeLyricsIdentity,
  type AuthorizedLyricsSource,
  type AuthorizedSourceTransport,
} from "../../src/renderer/features/lyrics/providers";
import { LyricsProviderError } from "../../src/renderer/features/lyrics/types";
import type {
  LyricsProvider,
  TrackIdentity,
} from "../../src/renderer/features/lyrics/types";

const track: TrackIdentity = {
  spotifyTrackId: "spotify-track-1",
  title: "Borrowed Light",
  artist: "Aura Test Ensemble",
  album: "Original Fixtures",
  durationMs: 182_000,
  isrc: "USAAA2600001",
};

const source: AuthorizedLyricsSource = {
  id: "owned-source",
  baseUrl: "https://lyrics.example.test/",
  searchUrlTemplate: "/search?title={title}&artist={artist}",
  resultLinkSelector: ".result",
  lyricsSelector: ".lyrics",
  titleSelector: ".title",
  artistSelector: ".artist",
  requestsPerMinute: 60,
  userAgent: "AuraAuthorizedAdapter/1.0",
  enabled: true,
  permissionConfirmed: true,
};

function makeTransport(
  overrides: Partial<AuthorizedSourceTransport> = {},
): AuthorizedSourceTransport {
  return {
    isAllowedByRobots: vi.fn(async () => true),
    getText: vi.fn(async () => '<p class="empty">No match</p>'),
    ...overrides,
  };
}

function searchPage(path = "/songs/borrowed-light"): string {
  return `<a class="result" href="${path}">Match</a>`;
}

function lyricsPage(text = "An original fixture line"): string {
  return [
    '<h1 class="title">Borrowed Light</h1>',
    '<p class="artist">Aura Test Ensemble</p>',
    `<div class="lyrics">${text}</div>`,
  ].join("");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("lyrics identity matching", () => {
  it("normalizes accents, featured artists, punctuation, and version labels", () => {
    expect(
      normalizeLyricsIdentity(
        "Beyoncé & Jay-Z (2026 Remastered Version) feat. Guest",
      ),
    ).toBe("beyonce and jay z");
  });

  it("prefers the strongest local title/artist match", async () => {
    const provider = new LocalLrcProvider([
      {
        id: "basic",
        fileName: "basic.lrc",
        contents: "[00:01.00]Basic candidate",
        title: "Borrowed Light (Live)",
        artist: "Aura Test Ensemble",
      },
      {
        id: "specific",
        fileName: "specific.lrc",
        contents: "[00:01.00]Specific candidate",
        title: "Borrowed Light",
        artist: "Áura Test Ensemble",
        album: "Original Fixtures",
        durationMs: 180_500,
      },
    ]);

    await expect(provider.findLyrics(track)).resolves.toMatchObject({
      kind: "synced",
      source: "specific.lrc",
      lines: [{ text: "Specific candidate" }],
    });
  });

  it("prioritizes an exact Spotify ID over an ISRC-only match", async () => {
    const provider = new LocalLrcProvider([
      {
        id: "isrc",
        fileName: "isrc.lrc",
        contents: "[00:01.00]ISRC candidate",
        isrc: track.isrc?.toLowerCase(),
      },
      {
        id: "spotify",
        fileName: "spotify.lrc",
        contents: "[00:01.00]Spotify candidate",
        spotifyTrackId: track.spotifyTrackId,
      },
    ]);

    await expect(provider.findLyrics(track)).resolves.toMatchObject({
      source: "spotify.lrc",
      lines: [{ text: "Spotify candidate" }],
    });
  });

  it("rejects malformed imports before mutating the local collection", () => {
    const provider = new LocalLrcProvider();

    expect(() =>
      provider.addEntry({
        id: "invalid",
        fileName: "invalid.lrc",
        contents: "Untimed words",
      }),
    ).toThrow("recognizable synchronized lyrics");
    expect(provider.listEntries()).toEqual([]);
  });

  it("retrieves, hydrates, and deletes persisted local lyrics", async () => {
    const persistedFile = {
      id: "a".repeat(64),
      fileName: "persisted.lrc",
      content: "[00:01.00]Persisted original line",
      sizeBytes: 39,
      importedAt: "2026-07-24T12:00:00.000Z",
      spotifyTrackId: track.spotifyTrackId,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
    };
    const persistence = {
      listImported: vi.fn(async () => [
        {
          id: persistedFile.id,
          fileName: persistedFile.fileName,
          sizeBytes: persistedFile.sizeBytes,
          importedAt: persistedFile.importedAt,
          spotifyTrackId: persistedFile.spotifyTrackId,
          title: persistedFile.title,
          artist: persistedFile.artist,
          durationMs: persistedFile.durationMs,
        },
      ]),
      readImported: vi.fn(async () => persistedFile),
      matchImported: vi.fn(async () => persistedFile),
      deleteImported: vi.fn(async () => ({ deleted: true })),
    };
    const provider = new LocalLrcProvider([], persistence);

    await expect(provider.findLyrics(track)).resolves.toMatchObject({
      kind: "synced",
      source: "persisted.lrc",
      lines: [{ text: "Persisted original line" }],
    });
    await expect(provider.findLyrics(track)).resolves.toMatchObject({
      source: "persisted.lrc",
    });
    expect(persistence.matchImported).toHaveBeenCalledOnce();

    await expect(provider.reloadPersistedEntries()).resolves.toEqual([
      expect.objectContaining({
        id: persistedFile.id,
        fileName: persistedFile.fileName,
      }),
    ]);
    await expect(
      provider.deletePersistedEntry(persistedFile.id),
    ).resolves.toEqual({ deleted: true });
    expect(provider.listEntries()).toEqual([]);
  });
});

describe("provider enablement and permission gates", () => {
  it("does not call a disabled licensed adapter", async () => {
    const lookup = vi.fn(async () => null);
    const provider = new LicensedLyricsProvider({
      id: "licensed",
      displayName: "Licensed source",
      enabled: false,
      lookup,
    });

    await expect(provider.findLyrics(track)).resolves.toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps disabled authorized sources inert", async () => {
    const transport = makeTransport();
    const provider = new AuthorizedScraperProvider(
      {
        ...source,
        enabled: false,
        permissionConfirmed: false,
      },
      transport,
    );

    await expect(provider.findLyrics(track)).resolves.toBeNull();
    expect(transport.isAllowedByRobots).not.toHaveBeenCalled();
    expect(transport.getText).not.toHaveBeenCalled();
  });

  it("requires explicit permission before any transport operation", async () => {
    const transport = makeTransport();
    const provider = new AuthorizedScraperProvider(
      { ...source, permissionConfirmed: undefined },
      transport,
    );

    await expect(provider.findLyrics(track)).rejects.toMatchObject({
      code: "permission-required",
      recoverable: false,
    });
    expect(transport.isAllowedByRobots).not.toHaveBeenCalled();
    expect(transport.getText).not.toHaveBeenCalled();
  });

  it("treats a robots denial as a hard stop without retries", async () => {
    const transport = makeTransport({
      isAllowedByRobots: vi.fn(async () => false),
    });
    const provider = new AuthorizedScraperProvider(source, transport);

    await expect(provider.findLyrics(track)).rejects.toMatchObject({
      code: "robots-denied",
      recoverable: false,
    });
    expect(transport.isAllowedByRobots).toHaveBeenCalledTimes(1);
    expect(transport.getText).not.toHaveBeenCalled();
  });

  it.each([
    [{ baseUrl: "http://lyrics.example.test/" }, "HTTPS"],
    [{ requestsPerMinute: 0 }, "between 1 and 60"],
    [{ requestsPerMinute: 61 }, "between 1 and 60"],
    [{ userAgent: "" }, "user agent"],
  ])("rejects an invalid authorized source", (patch, message) => {
    expect(
      () =>
        new AuthorizedScraperProvider(
          { ...source, ...patch },
          makeTransport(),
        ),
    ).toThrow(message);
  });

  it("never follows a result link outside the authorized origin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const transport = makeTransport({
      getText: vi.fn(async () => searchPage("https://other.test/song")),
    });
    const provider = new AuthorizedScraperProvider(source, transport);
    const assertion = expect(provider.findLyrics(track)).rejects.toMatchObject({
      code: "invalid-source",
      recoverable: false,
    });

    await vi.runAllTimersAsync();
    await assertion;
    expect(transport.isAllowedByRobots).toHaveBeenCalledTimes(1);
    expect(transport.getText).toHaveBeenCalledTimes(1);
  });

  it("rejects a page whose declared identity does not match the track", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const transport = makeTransport({
      getText: vi.fn(async (url) =>
        url.includes("/search")
          ? searchPage()
          : lyricsPage("Wrong track text").replace(
              "Borrowed Light",
              "Different Song",
            ),
      ),
    });
    const provider = new AuthorizedScraperProvider(source, transport);
    const firstLookup = provider.findLyrics(track);

    await vi.runAllTimersAsync();

    await expect(firstLookup).resolves.toBeNull();
    const secondLookup = provider.findLyrics(track);
    await vi.runAllTimersAsync();
    await expect(secondLookup).resolves.toBeNull();
    expect(transport.isAllowedByRobots).toHaveBeenCalledTimes(4);
    expect(transport.getText).toHaveBeenCalledTimes(4);
  });
});

describe("authorized transport retries", () => {
  it("uses exponential backoff for explicit transient failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const searchAttemptTimes: number[] = [];
    let searchAttempts = 0;
    const transport = makeTransport({
      getText: vi.fn(async (url) => {
        if (url.includes("/search")) {
          searchAttemptTimes.push(Date.now());
          searchAttempts += 1;
          if (searchAttempts === 1) {
            throw new AuthorizedSourceTransportError({
              code: "network",
              message: "Temporary network loss",
            });
          }
          if (searchAttempts === 2) {
            throw new AuthorizedSourceTransportError({
              code: "rate-limited",
              message: "Slow down",
              retryAfterMs: 1_500,
            });
          }
          return searchPage();
        }
        return lyricsPage();
      }),
    });
    const provider = new AuthorizedScraperProvider(source, transport);
    const lookup = provider.findLyrics(track);

    await vi.runAllTimersAsync();

    await expect(lookup).resolves.toEqual({
      kind: "plain",
      source: "owned-source",
      text: "An original fixture line",
    });
    expect(searchAttemptTimes).toEqual([1_000, 2_000, 4_000]);
    expect(transport.getText).toHaveBeenCalledTimes(4);
  });

  it("stops after three transient attempts and maps the final failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const transport = makeTransport({
      getText: vi.fn(async () => {
        throw new AuthorizedSourceTransportError({
          code: "network",
          message: "Still offline",
        });
      }),
    });
    const provider = new AuthorizedScraperProvider(source, transport);
    const assertion = expect(provider.findLyrics(track)).rejects.toMatchObject({
      code: "network",
      providerId: "authorized:owned-source",
    });

    await vi.runAllTimersAsync();
    await assertion;
    expect(transport.getText).toHaveBeenCalledTimes(3);
  });

  it("does not retry rejected or unclassified failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rejectedTransport = makeTransport({
      getText: vi.fn(async () => {
        throw new AuthorizedSourceTransportError({
          code: "rejected",
          message: "Forbidden",
        });
      }),
    });
    const rejectedProvider = new AuthorizedScraperProvider(
      source,
      rejectedTransport,
    );
    const rejectedAssertion = expect(
      rejectedProvider.findLyrics(track),
    ).rejects.toMatchObject({ code: "unknown" });

    await vi.runAllTimersAsync();
    await rejectedAssertion;
    expect(rejectedTransport.getText).toHaveBeenCalledTimes(1);

    const unknownTransport = makeTransport({
      getText: vi.fn(async () => {
        throw new Error("Unexpected parser failure");
      }),
    });
    const unknownProvider = new AuthorizedScraperProvider(
      source,
      unknownTransport,
    );
    const unknownAssertion = expect(
      unknownProvider.findLyrics(track),
    ).rejects.toMatchObject({ code: "unknown" });

    await vi.runAllTimersAsync();
    await unknownAssertion;
    expect(unknownTransport.getText).toHaveBeenCalledTimes(1);
  });

  it("aborts during backoff without starting another attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    const transport = makeTransport({
      getText: vi.fn(async () => {
        throw new AuthorizedSourceTransportError({
          code: "network",
          message: "Temporary network loss",
        });
      }),
    });
    const provider = new AuthorizedScraperProvider(source, transport);
    const lookup = provider.findLyrics(track, controller.signal);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.getText).toHaveBeenCalledTimes(1);
    controller.abort();

    await expect(lookup).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    expect(transport.getText).toHaveBeenCalledTimes(1);
  });

  it("serializes every transport operation across concurrent lookups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let activeOperations = 0;
    let maximumActiveOperations = 0;
    const runOperation = async <T>(result: T): Promise<T> => {
      activeOperations += 1;
      maximumActiveOperations = Math.max(
        maximumActiveOperations,
        activeOperations,
      );
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      activeOperations -= 1;
      return result;
    };
    const transport = makeTransport({
      isAllowedByRobots: vi.fn(async () => runOperation(true)),
      getText: vi.fn(async () =>
        runOperation('<p class="empty">No result</p>'),
      ),
    });
    const provider = new AuthorizedScraperProvider(source, transport);
    const first = provider.findLyrics(track);
    const second = provider.findLyrics({
      ...track,
      spotifyTrackId: "spotify-track-2",
      title: "Second Original",
    });

    await vi.runAllTimersAsync();

    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(maximumActiveOperations).toBe(1);
    expect(transport.isAllowedByRobots).toHaveBeenCalledTimes(2);
    expect(transport.getText).toHaveBeenCalledTimes(2);
  });
});

describe("provider chain cancellation", () => {
  it("does not swallow cancellation or continue to later providers", async () => {
    const controller = new AbortController();
    const abortingProvider: LyricsProvider = {
      id: "aborting",
      findLyrics: vi.fn(async (_track, signal) => {
        controller.abort();
        signal?.throwIfAborted();
        return null;
      }),
    };
    const fallbackProvider: LyricsProvider = {
      id: "fallback",
      findLyrics: vi.fn(async () => null),
    };
    const onProviderError = vi.fn();
    const chain = new LyricsProviderChain(
      [abortingProvider, fallbackProvider],
      onProviderError,
    );

    await expect(
      chain.findLyrics(track, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fallbackProvider.findLyrics).not.toHaveBeenCalled();
    expect(onProviderError).not.toHaveBeenCalled();
  });

  it("reports ordinary provider errors and continues the chain", async () => {
    const onProviderError = vi.fn();
    const broken: LyricsProvider = {
      id: "broken",
      findLyrics: vi.fn(async () => {
        throw new LyricsProviderError({
          code: "network",
          providerId: "broken",
          message: "Offline",
        });
      }),
    };
    const result = {
      kind: "plain" as const,
      source: "fallback",
      text: "Original fallback line",
    };
    const fallback: LyricsProvider = {
      id: "fallback",
      findLyrics: vi.fn(async () => result),
    };

    await expect(
      new LyricsProviderChain(
        [broken, fallback],
        onProviderError,
      ).findLyrics(track),
    ).resolves.toEqual(result);
    expect(onProviderError).toHaveBeenCalledOnce();
  });
});
