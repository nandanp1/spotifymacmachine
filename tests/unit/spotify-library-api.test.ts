import { describe, expect, it, vi } from "vitest";

import {
  SpotifyApiClient,
  SpotifyApiError,
} from "../../src/renderer/features/devices/spotify-api";
import { toSpotifyOpenUrl } from "../../src/renderer/features/library";

const TRACK = {
  id: "track1",
  name: "Window Light",
  uri: "spotify:track:track1",
  duration_ms: 203_000,
  explicit: false,
  is_playable: true,
  is_local: false,
  type: "track",
  artists: [
    {
      id: "artist1",
      name: "North Room",
      uri: "spotify:artist:artist1",
    },
  ],
  album: {
    id: "album1",
    name: "Soft Architecture",
    uri: "spotify:album:album1",
    images: [
      {
        url: "https://i.scdn.co/image/cover1",
        height: 640,
        width: 640,
      },
    ],
  },
} as const;

describe("Spotify library API", () => {
  it("searches tracks with bounded paging, authorization, and cancellation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        tracks: pageResponse([TRACK], {
          limit: 7,
          offset: 10,
          total: 24,
          next: "https://api.spotify.test/v1/search?offset=17",
          previous: "https://api.spotify.test/v1/search?offset=3",
        }),
      }),
    );
    const client = createClient(fetchImplementation);
    const controller = new AbortController();

    const page = await client.searchTracks("  window light  ", {
      limit: 7,
      offset: 10,
      signal: controller.signal,
    });

    expect(page).toEqual({
      items: [
        {
          id: "track1",
          name: "Window Light",
          uri: "spotify:track:track1",
          durationMs: 203_000,
          explicit: false,
          isPlayable: true,
          isLocal: false,
          artists: [
            {
              id: "artist1",
              name: "North Room",
              uri: "spotify:artist:artist1",
            },
          ],
          album: {
            id: "album1",
            name: "Soft Architecture",
            uri: "spotify:album:album1",
            images: [
              {
                url: "https://i.scdn.co/image/cover1",
                height: 640,
                width: 640,
              },
            ],
          },
        },
      ],
      limit: 7,
      offset: 10,
      total: 24,
      nextOffset: 17,
      previousOffset: 3,
    });

    const [requestUrl, requestInit] = firstFetchCall(fetchImplementation);
    expect(requestUrl).toBe(
      "https://api.spotify.test/v1/search?q=window+light&type=track&limit=7&offset=10",
    );
    expect(requestInit?.method).toBe("GET");
    expect(requestInit?.signal).toBe(controller.signal);
    expect(new Headers(requestInit?.headers).get("Authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("loads saved tracks, playlists, and current playlist items", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/me/tracks?")) {
        return jsonResponse(
          pageResponse([
            {
              added_at: "2026-07-18T09:30:00Z",
              track: TRACK,
            },
          ]),
        );
      }
      if (url.includes("/me/playlists?")) {
        return jsonResponse(
          pageResponse([
            {
              id: "playlist1",
              name: "Quiet Rooms",
              description: "Tracks for late light.",
              uri: "spotify:playlist:playlist1",
              images: [],
              owner: {
                id: "owner1",
                display_name: "Aura Listener",
              },
              items: { total: 2 },
              collaborative: false,
              public: false,
            },
          ]),
        );
      }
      if (url.includes("/playlists/playlist1/items?")) {
        return jsonResponse(
          pageResponse(
            [
              {
                added_at: "2026-07-19T09:30:00Z",
                is_local: false,
                item: TRACK,
              },
              {
                added_at: null,
                is_local: false,
                item: null,
              },
            ],
            { total: 2 },
          ),
        );
      }
      return jsonResponse({ error: { message: "Unexpected test URL." } }, 500);
    });
    const client = createClient(fetchImplementation);

    const [saved, playlists, playlistTracks] = await Promise.all([
      client.getSavedTracks({ limit: 12 }),
      client.getUserPlaylists(),
      client.getPlaylistTracks("playlist1", { offset: 0 }),
    ]);

    expect(saved.items[0]).toMatchObject({
      addedAt: "2026-07-18T09:30:00Z",
      track: { id: "track1", durationMs: 203_000 },
    });
    expect(playlists.items[0]).toEqual({
      id: "playlist1",
      name: "Quiet Rooms",
      description: "Tracks for late light.",
      uri: "spotify:playlist:playlist1",
      images: [],
      owner: {
        id: "owner1",
        displayName: "Aura Listener",
      },
      itemCount: 2,
      collaborative: false,
      public: false,
    });
    expect(playlistTracks.items).toHaveLength(1);
    expect(playlistTracks.items[0]).toMatchObject({
      addedAt: "2026-07-19T09:30:00Z",
      isLocal: false,
      track: { id: "track1" },
    });
    expect(
      fetchImplementation.mock.calls.some(([url]) =>
        String(url).includes("/playlists/playlist1/items?limit=20&offset=0"),
      ),
    ).toBe(true);
  });

  it("starts track or context playback and adds an item to the queue", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      emptyResponse(),
    );
    const client = createClient(fetchImplementation);

    await client.startPlayback({
      uri: TRACK.uri,
      deviceId: "device 1",
      positionMs: 1_250,
    });
    await client.startPlayback({
      contextUri: "spotify:playlist:playlist1",
      offset: { uri: TRACK.uri },
    });
    await client.addToQueue(TRACK.uri, { deviceId: "device 1" });

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "https://api.spotify.test/v1/me/player/play?device_id=device+1",
    );
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1])).toEqual({
      uris: [TRACK.uri],
      position_ms: 1_250,
    });
    expect(readJsonBody(fetchImplementation.mock.calls[1]?.[1])).toEqual({
      context_uri: "spotify:playlist:playlist1",
      offset: { uri: TRACK.uri },
    });
    expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
      "https://api.spotify.test/v1/me/player/queue?device_id=device+1&uri=spotify%3Atrack%3Atrack1",
    );
    expect(fetchImplementation.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("rejects malformed Spotify pages instead of presenting partial success", async () => {
    const client = createClient(
      vi.fn<typeof fetch>(async () =>
        jsonResponse({
          tracks: pageResponse([
            {
              ...TRACK,
              album: { name: "Missing identity and artwork" },
            },
          ]),
        }),
      ),
    );

    await expect(client.searchTracks("window")).rejects.toMatchObject({
      name: "SpotifyApiError",
      code: "invalid-response",
      status: null,
    });
  });

  it("maps token failures and Spotify auth, Premium, rate-limit, and no-device responses", async () => {
    const unavailableFetch = vi.fn<typeof fetch>();
    const tokenFailureClient = new SpotifyApiClient({
      getAccessToken: async () => {
        throw new Error("Keychain unavailable");
      },
      fetchImplementation: unavailableFetch,
    });
    await expect(tokenFailureClient.getSavedTracks()).rejects.toMatchObject({
      code: "authentication",
      action: "Sign in to Spotify again.",
    });
    expect(unavailableFetch).not.toHaveBeenCalled();

    await expect(
      clientForResponse(
        jsonResponse({ error: { message: "The access token expired" } }, 401),
      ).getSavedTracks(),
    ).rejects.toMatchObject({
      code: "authentication",
      status: 401,
    });

    await expect(
      clientForResponse(
        jsonResponse({ error: { message: "Premium required" } }, 403),
      ).startPlayback({ uri: TRACK.uri }),
    ).rejects.toMatchObject({
      code: "premium-required",
      status: 403,
    });

    const rateLimited = clientForResponse(
      jsonResponse(
        { error: { message: "Slow down" } },
        429,
        { "Retry-After": "8" },
      ),
    );
    await expect(rateLimited.searchTracks("window")).rejects.toMatchObject({
      code: "rate-limited",
      status: 429,
      retryAfterSeconds: 8,
      action: "Try again in 8 seconds.",
    });

    await expect(
      clientForResponse(
        jsonResponse({ error: { message: "Player command failed" } }, 404),
      ).addToQueue(TRACK.uri),
    ).rejects.toMatchObject({
      code: "no-active-device",
      status: 404,
    });
  });

  it("derives only supported open.spotify.com links from Spotify URIs", () => {
    expect(toSpotifyOpenUrl(TRACK.uri)).toBe(
      "https://open.spotify.com/track/track1",
    );
    expect(toSpotifyOpenUrl("spotify:playlist:playlist1")).toBe(
      "https://open.spotify.com/playlist/playlist1",
    );
    expect(toSpotifyOpenUrl("https://attacker.example/track/track1")).toBeNull();
    expect(toSpotifyOpenUrl("spotify:local:artist:album:title:120")).toBeNull();
  });
});

function createClient(fetchImplementation: typeof fetch): SpotifyApiClient {
  return new SpotifyApiClient({
    getAccessToken: async () => "access-token",
    fetchImplementation,
    baseUrl: "https://api.spotify.test/v1",
  });
}

function clientForResponse(response: Response): SpotifyApiClient {
  return createClient(vi.fn<typeof fetch>(async () => response.clone()));
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 });
}

function pageResponse(
  items: unknown[],
  overrides: Partial<{
    limit: number;
    offset: number;
    total: number;
    next: string | null;
    previous: string | null;
  }> = {},
) {
  return {
    items,
    limit: overrides.limit ?? 20,
    offset: overrides.offset ?? 0,
    total: overrides.total ?? items.length,
    next: overrides.next ?? null,
    previous: overrides.previous ?? null,
  };
}

function firstFetchCall(
  fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>,
): [RequestInfo | URL, RequestInit?] {
  const call = fetchImplementation.mock.calls[0];
  if (!call) {
    throw new SpotifyApiError({
      code: "invalid-response",
      message: "Expected the test fetch implementation to be called.",
      action: "Fix the unit test.",
    });
  }
  return call;
}

function readJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return JSON.parse(init.body) as unknown;
}
