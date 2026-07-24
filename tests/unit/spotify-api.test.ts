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

describe("Spotify API error mapping", () => {
  it.each([
    [401, "authentication", "Sign in to Spotify again."],
    [403, "premium-required", "Confirm the account has Premium"],
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
