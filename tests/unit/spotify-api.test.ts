import { describe, expect, it, vi } from "vitest";

import {
  SpotifyApiClient,
  SpotifyApiError,
} from "../../src/renderer/features/devices/spotify-api";

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("Spotify device API", () => {
  it("binds the default browser fetch implementation to its global receiver", async () => {
    const fetchImplementation = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(jsonResponse({ devices: [] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImplementation);

    try {
      const client = new SpotifyApiClient({
        getAccessToken: async () => "access-token",
      });

      await expect(client.getAvailableDevices()).resolves.toEqual([]);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("validates, normalizes, and sorts available devices", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        devices: [
          {
            id: "speaker",
            is_active: false,
            is_private_session: true,
            is_restricted: false,
            name: "Bedroom Speaker",
            type: "Speaker",
            volume_percent: 101.2,
            supports_volume: true,
          },
          { not_a_device: true },
          {
            id: "mac",
            is_active: true,
            name: "Aura Player — Mac",
            volume_percent: -2,
          },
          {
            id: null,
            is_active: false,
            name: "Another device",
            volume_percent: Number.NaN,
          },
        ],
      }),
    );
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation,
      baseUrl: "https://api.spotify.test/v1/",
    });

    await expect(client.getAvailableDevices()).resolves.toEqual([
      {
        id: "mac",
        isActive: true,
        isPrivateSession: false,
        isRestricted: false,
        name: "Aura Player — Mac",
        type: "Unknown",
        volumePercent: 0,
        supportsVolume: false,
      },
      {
        id: null,
        isActive: false,
        isPrivateSession: false,
        isRestricted: false,
        name: "Another device",
        type: "Unknown",
        volumePercent: null,
        supportsVolume: false,
      },
      {
        id: "speaker",
        isActive: false,
        isPrivateSession: true,
        isRestricted: false,
        name: "Bedroom Speaker",
        type: "Speaker",
        volumePercent: 100,
        supportsVolume: true,
      },
    ]);

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.spotify.test/v1/me/player/devices",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
      }),
    );
  });

  it("sends an explicit user-selected transfer and handles 204", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation,
    });

    await expect(
      client.transferPlayback("device-1", { play: false }),
    ).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/me/player",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          device_ids: ["device-1"],
          play: false,
        }),
      }),
    );
  });

  it("rejects an empty transfer target before reading a token", async () => {
    const getAccessToken = vi.fn(async () => "access-token");
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = new SpotifyApiClient({
      getAccessToken,
      fetchImplementation,
    });

    await expect(client.transferPlayback("  ")).rejects.toMatchObject({
      code: "no-active-device",
      status: null,
    });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects malformed device payloads", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse({ unexpected: [] }),
      ),
    });

    await expect(client.getAvailableDevices()).rejects.toMatchObject({
      code: "invalid-response",
      action: "Refresh the device list.",
    });
  });
});

describe("Spotify remote playback API", () => {
  it("validates and maps the current Spotify playback snapshot", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        device: {
          id: "device-1",
          is_active: true,
          is_private_session: false,
          is_restricted: false,
          name: "Living Room",
          type: "Speaker",
          volume_percent: 42,
          supports_volume: true,
        },
        repeat_state: "context",
        shuffle_state: true,
        context: { uri: "spotify:playlist:playlist1" },
        timestamp: 1_721_782_400_000,
        progress_ms: 12_345,
        is_playing: true,
        item: {
          id: "track1",
          uri: "spotify:track:track1",
          name: "Window Light",
          duration_ms: 203_000,
          is_playable: false,
          artists: [{ name: "North Room" }, { name: "After Hours" }],
          album: {
            name: "Soft Architecture",
            uri: "spotify:album:album1",
            images: [
              {
                url: "https://i.scdn.co/image/cover1",
                width: 640,
                height: 640,
              },
              {
                url: "https://i.scdn.co/image/cover2",
                width: null,
                height: null,
              },
            ],
          },
        },
        currently_playing_type: "track",
        actions: {
          seeking: true,
          skipping_prev: true,
        },
      }),
    );
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation,
    });

    await expect(
      client.getCurrentPlayback(controller.signal),
    ).resolves.toEqual({
      device: {
        id: "device-1",
        isActive: true,
        isPrivateSession: false,
        isRestricted: false,
        name: "Living Room",
        type: "Speaker",
        volumePercent: 42,
        supportsVolume: true,
      },
      track: {
        id: "track1",
        uri: "spotify:track:track1",
        title: "Window Light",
        artists: ["North Room", "After Hours"],
        album: {
          name: "Soft Architecture",
          uri: "spotify:album:album1",
          images: [
            {
              url: "https://i.scdn.co/image/cover1",
              width: 640,
              height: 640,
            },
            {
              url: "https://i.scdn.co/image/cover2",
            },
          ],
        },
        durationMs: 203_000,
        isPlayable: false,
      },
      itemType: "track",
      isPlaying: true,
      progressMs: 12_345,
      contextUri: "spotify:playlist:playlist1",
      repeatMode: "context",
      shuffle: true,
      restrictions: {
        pausing: false,
        resuming: false,
        seeking: true,
        skippingNext: false,
        skippingPrevious: true,
      },
      timestamp: 1_721_782_400_000,
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/me/player",
      expect.objectContaining({
        method: "GET",
        signal: controller.signal,
      }),
    );
  });

  it("returns null for no active playback and rejects malformed snapshots", async () => {
    const noPlaybackClient = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 204 }),
      ),
    });
    await expect(noPlaybackClient.getCurrentPlayback()).resolves.toBeNull();

    const invalidPlaybackClient = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse({
          device: { id: "device-1", name: "Living Room" },
          repeat_state: "off",
          shuffle_state: false,
          context: null,
          timestamp: 1,
          progress_ms: 0,
          is_playing: true,
          item: { id: "not-a-complete-track" },
          currently_playing_type: "track",
          actions: {},
        }),
      ),
    });
    await expect(
      invalidPlaybackClient.getCurrentPlayback(),
    ).rejects.toMatchObject({
      code: "invalid-response",
      action: "Refresh playback state.",
    });
  });

  it("keeps device and control state for a valid Spotify local file", async () => {
    const localUri =
      "spotify:local:Aura+Test:Original+Fixtures:Local+Light:182";
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse({
          device: {
            id: "device-1",
            is_active: true,
            is_private_session: false,
            is_restricted: false,
            name: "Living Room",
            type: "Speaker",
            volume_percent: 36,
            supports_volume: true,
          },
          repeat_state: "off",
          shuffle_state: false,
          context: null,
          timestamp: 1_721_782_400_000,
          progress_ms: 2_000,
          is_playing: true,
          item: {
            id: null,
            uri: localUri,
            name: "Local Light",
            duration_ms: 182_000,
            artists: [{ name: "Aura Test Ensemble" }],
            album: {
              name: "Original Fixtures",
              uri: null,
              images: [],
            },
          },
          currently_playing_type: "track",
          actions: { seeking: true },
        }),
      ),
    });

    await expect(client.getCurrentPlayback()).resolves.toMatchObject({
      device: {
        id: "device-1",
        isActive: true,
        name: "Living Room",
      },
      track: {
        id: localUri,
        uri: localUri,
        title: "Local Light",
        album: {
          name: "Original Fixtures",
          images: [],
        },
      },
      isPlaying: true,
      restrictions: {
        seeking: true,
      },
    });
  });

  it("targets every playback control at the explicit device", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation,
      baseUrl: "https://api.spotify.test/v1/",
    });

    await client.resumePlayback(" device/1 ", controller.signal);
    await client.pausePlayback(" device/1 ", controller.signal);
    await client.skipToNext(" device/1 ", controller.signal);
    await client.skipToPrevious(" device/1 ", controller.signal);
    await client.seekPlayback(" device/1 ", 1_250, controller.signal);
    await client.setPlaybackVolume(" device/1 ", 37, controller.signal);

    expect(
      fetchImplementation.mock.calls.map(([url, init]) => ({
        url,
        method: init?.method,
        signal: init?.signal,
        body: init?.body,
      })),
    ).toEqual([
      {
        url: "https://api.spotify.test/v1/me/player/play?device_id=device%2F1",
        method: "PUT",
        signal: controller.signal,
        body: undefined,
      },
      {
        url: "https://api.spotify.test/v1/me/player/pause?device_id=device%2F1",
        method: "PUT",
        signal: controller.signal,
        body: undefined,
      },
      {
        url: "https://api.spotify.test/v1/me/player/next?device_id=device%2F1",
        method: "POST",
        signal: controller.signal,
        body: undefined,
      },
      {
        url: "https://api.spotify.test/v1/me/player/previous?device_id=device%2F1",
        method: "POST",
        signal: controller.signal,
        body: undefined,
      },
      {
        url: "https://api.spotify.test/v1/me/player/seek?device_id=device%2F1&position_ms=1250",
        method: "PUT",
        signal: controller.signal,
        body: undefined,
      },
      {
        url: "https://api.spotify.test/v1/me/player/volume?device_id=device%2F1&volume_percent=37",
        method: "PUT",
        signal: controller.signal,
        body: undefined,
      },
    ]);
  });

  it("rejects missing device targets and invalid values before token access", async () => {
    const getAccessToken = vi.fn(async () => "access-token");
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = new SpotifyApiClient({
      getAccessToken,
      fetchImplementation,
    });
    const missingTargetCommands = [
      () => client.resumePlayback(" "),
      () => client.pausePlayback("\t"),
      () => client.skipToNext(""),
      () => client.skipToPrevious("\n"),
      () => client.seekPlayback(" ", 1_000),
      () => client.setPlaybackVolume(" ", 50),
    ];

    for (const command of missingTargetCommands) {
      await expect(command()).rejects.toMatchObject({
        code: "no-active-device",
      });
    }
    await expect(client.seekPlayback("device-1", -1)).rejects.toMatchObject({
      code: "invalid-request",
    });
    await expect(
      client.setPlaybackVolume("device-1", 50.5),
    ).rejects.toMatchObject({
      code: "invalid-request",
    });
    await expect(
      client.setPlaybackVolume("device-1", 101),
    ).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("Spotify API error mapping", () => {
  it.each([
    [401, "authentication", "Sign in to Spotify again."],
    [404, "no-active-device", "Refresh Available Devices"],
    [500, "rejected", "Try again or choose another playback device."],
  ])(
    "maps HTTP %i to %s",
    async (status, expectedCode, expectedAction) => {
      const client = new SpotifyApiClient({
        getAccessToken: async () => "access-token",
        fetchImplementation: vi.fn<typeof fetch>(async () =>
          jsonResponse(
            { error: { message: `Server message ${status}` } },
            { status },
          ),
        ),
      });

      const error = await client
        .getCurrentPlayback()
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(SpotifyApiError);
      expect(error).toMatchObject({
        code: expectedCode,
        status,
        message: `Server message ${status}`,
      });
      expect((error as SpotifyApiError).action).toContain(expectedAction);
    },
  );

  it("keeps a generic playback 403 distinct from Premium eligibility", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              message: "Playback command is not allowed right now",
              reason: "UNKNOWN",
            },
          },
          { status: 403 },
        ),
      ),
    });

    await expect(client.getCurrentPlayback()).rejects.toMatchObject({
      code: "rejected",
      status: 403,
      message: "Playback command is not allowed right now",
      reason: "UNKNOWN",
      action: expect.stringContaining("playback permissions"),
    });
  });

  it("maps a confident Premium playback 403 to premium-required", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              message: "A Spotify Premium account is required",
              reason: "PREMIUM_REQUIRED",
            },
          },
          { status: 403 },
        ),
      ),
    });

    await expect(client.getCurrentPlayback()).rejects.toMatchObject({
      code: "premium-required",
      status: 403,
      message: "A Spotify Premium account is required",
      reason: "PREMIUM_REQUIRED",
      action: expect.stringContaining("Premium"),
    });
  });

  it("parses a valid rate-limit delay", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse(
          { error: { message: "Slow down" } },
          {
            status: 429,
            headers: { "Retry-After": "7" },
          },
        ),
      ),
    });

    await expect(client.getCurrentPlayback()).rejects.toMatchObject({
      code: "rate-limited",
      status: 429,
      retryAfterSeconds: 7,
      action: "Try again in 7 seconds.",
    });
  });

  it("maps Spotify quota exhaustion as a terminal API problem", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              message: "Application request quota exceeded",
              reason: "QUOTA_EXCEEDED",
            },
          },
          {
            status: 429,
            headers: { "Retry-After": "7" },
          },
        ),
      ),
    });

    await expect(client.getCurrentPlayback()).rejects.toMatchObject({
      code: "quota-exceeded",
      status: 429,
      retryAfterSeconds: null,
      reason: "QUOTA_EXCEEDED",
      message: "Application request quota exceeded",
      action: expect.stringContaining("quota to reset"),
    });
  });

  it("does not invent a delay when Retry-After is absent", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 429 }),
      ),
    });

    await expect(client.getCurrentPlayback()).rejects.toMatchObject({
      code: "rate-limited",
      retryAfterSeconds: null,
      action: "Try again shortly.",
    });
  });

  it("maps token and network failures without exposing their details", async () => {
    const tokenFailure = new SpotifyApiClient({
      getAccessToken: async () => {
        throw new Error("keychain detail");
      },
      fetchImplementation: vi.fn<typeof fetch>(),
    });
    await expect(tokenFailure.getCurrentPlayback()).rejects.toMatchObject({
      code: "authentication",
      message: "Spotify authorization could not be refreshed.",
    });

    const networkFailure = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () => {
        throw new TypeError("socket detail");
      }),
    });
    await expect(networkFailure.getCurrentPlayback()).rejects.toMatchObject({
      code: "network",
      message: "Aura Player could not reach Spotify.",
    });
  });

  it("preserves a typed access-token failure", async () => {
    const tokenFailure = new SpotifyApiError({
      code: "network",
      message: "Spotify credentials are temporarily unavailable.",
      action: "Check the network and try again.",
      cause: new Error("redacted IPC detail"),
    });
    const client = new SpotifyApiClient({
      getAccessToken: async () => {
        throw tokenFailure;
      },
      fetchImplementation: vi.fn<typeof fetch>(),
    });

    await expect(client.getCurrentPlayback()).rejects.toBe(tokenFailure);
  });

  it("preserves AbortError instead of remapping cancellation as offline", async () => {
    const abortError = new DOMException("Cancelled", "AbortError");
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(async () => {
        throw abortError;
      }),
    });

    await expect(client.getCurrentPlayback()).rejects.toBe(abortError);
  });

  it("reports an unreadable successful JSON response", async () => {
    const client = new SpotifyApiClient({
      getAccessToken: async () => "access-token",
      fetchImplementation: vi.fn<typeof fetch>(
        async () =>
          new Response("not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    });

    await expect(client.getCurrentPlayback()).rejects.toMatchObject({
      code: "invalid-response",
      status: 200,
    });
  });
});
