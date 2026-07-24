import {
  parsePlaylistTracksResponse,
  parsePlaylistsResponse,
  parseSavedTracksResponse,
  parseTrackSearchResponse,
} from "../library/spotify-response";
import type {
  SpotifyPagingOptions,
  SpotifyPlaylistPage,
  SpotifyPlaylistTrackPage,
  SpotifyQueueOptions,
  SpotifySavedTrackPage,
  SpotifyStartPlaybackOptions,
  SpotifyTrackPage,
} from "../library/types";

export type {
  SpotifyPagingOptions,
  SpotifyPlaylistPage,
  SpotifyPlaylistTrackPage,
  SpotifyQueueOptions,
  SpotifySavedTrackPage,
  SpotifyStartPlaybackOptions,
  SpotifyTrackPage,
} from "../library/types";

export interface SpotifyDevice {
  id: string | null;
  isActive: boolean;
  isPrivateSession: boolean;
  isRestricted: boolean;
  name: string;
  type: string;
  volumePercent: number | null;
  supportsVolume: boolean;
}

export type SpotifyApiProblemCode =
  | "authentication"
  | "premium-required"
  | "no-active-device"
  | "rate-limited"
  | "network"
  | "rejected"
  | "invalid-request"
  | "invalid-response";

export class SpotifyApiError extends Error {
  readonly code: SpotifyApiProblemCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly action: string;
  override readonly cause?: unknown;

  constructor(options: {
    code: SpotifyApiProblemCode;
    message: string;
    action: string;
    status?: number;
    retryAfterSeconds?: number | null;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "SpotifyApiError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.action = options.action;
    this.cause = options.cause;
  }
}

export interface SpotifyApiClientOptions {
  getAccessToken: () => Promise<string>;
  fetchImplementation?: typeof fetch;
  baseUrl?: string;
}

export class SpotifyApiClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: SpotifyApiClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.spotify.com/v1").replace(
      /\/+$/,
      "",
    );
  }

  async getAvailableDevices(signal?: AbortSignal): Promise<SpotifyDevice[]> {
    const body = await this.request(
      "/me/player/devices",
      {
        method: "GET",
        signal,
      },
      "player",
    );
    if (!isRecord(body) || !Array.isArray(body.devices)) {
      throw new SpotifyApiError({
        code: "invalid-response",
        message: "Spotify returned an invalid devices response.",
        action: "Refresh the device list.",
      });
    }

    return body.devices
      .map(parseDevice)
      .filter((device): device is SpotifyDevice => device !== null)
      .sort(
        (left, right) =>
          Number(right.isActive) - Number(left.isActive) ||
          left.name.localeCompare(right.name),
      );
  }

  async transferPlayback(
    deviceId: string,
    options: { play?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    if (!deviceId.trim()) {
      throw new SpotifyApiError({
        code: "no-active-device",
        message: "Choose a Spotify device before transferring playback.",
        action: "Open Available Devices and select a device.",
      });
    }

    await this.request(
      "/me/player",
      {
        method: "PUT",
        body: JSON.stringify({
          device_ids: [deviceId],
          ...(options.play === undefined ? {} : { play: options.play }),
        }),
        signal: options.signal,
      },
      "player",
    );
  }

  async getCurrentPlayback(
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    return this.request(
      "/me/player",
      {
        method: "GET",
        signal,
      },
      "player",
    );
  }

  async searchTracks(
    query: string,
    options: SpotifyPagingOptions = {},
  ): Promise<SpotifyTrackPage> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw invalidRequest(
        "Enter a track, artist, or album to search Spotify.",
        "Type a search term and try again.",
      );
    }

    const { limit, offset } = validatePaging(options, {
      defaultLimit: 10,
      maximumLimit: 10,
    });
    const parameters = new URLSearchParams({
      q: normalizedQuery,
      type: "track",
      limit: String(limit),
      offset: String(offset),
    });
    const body = await this.request(`/search?${parameters.toString()}`, {
      method: "GET",
      signal: options.signal,
    });

    return requireValidLibraryResponse(
      parseTrackSearchResponse(body),
      "search",
    );
  }

  async getSavedTracks(
    options: SpotifyPagingOptions = {},
  ): Promise<SpotifySavedTrackPage> {
    const { limit, offset } = validatePaging(options, {
      defaultLimit: 20,
      maximumLimit: 50,
    });
    const parameters = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const body = await this.request(`/me/tracks?${parameters.toString()}`, {
      method: "GET",
      signal: options.signal,
    });

    return requireValidLibraryResponse(
      parseSavedTracksResponse(body),
      "saved tracks",
    );
  }

  async getUserPlaylists(
    options: SpotifyPagingOptions = {},
  ): Promise<SpotifyPlaylistPage> {
    const { limit, offset } = validatePaging(options, {
      defaultLimit: 20,
      maximumLimit: 50,
    });
    const parameters = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const body = await this.request(`/me/playlists?${parameters.toString()}`, {
      method: "GET",
      signal: options.signal,
    });

    return requireValidLibraryResponse(
      parsePlaylistsResponse(body),
      "playlists",
    );
  }

  async getCurrentUserPlaylists(
    options: SpotifyPagingOptions = {},
  ): Promise<SpotifyPlaylistPage> {
    return this.getUserPlaylists(options);
  }

  async getPlaylistTracks(
    playlistId: string,
    options: SpotifyPagingOptions = {},
  ): Promise<SpotifyPlaylistTrackPage> {
    const normalizedId = requireValue(
      playlistId,
      "Choose a playlist before loading its tracks.",
      "Return to Playlists and choose one.",
    );
    const { limit, offset } = validatePaging(options, {
      defaultLimit: 20,
      maximumLimit: 50,
    });
    const parameters = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const body = await this.request(
      `/playlists/${encodeURIComponent(normalizedId)}/items?${parameters.toString()}`,
      {
        method: "GET",
        signal: options.signal,
      },
    );

    return requireValidLibraryResponse(
      parsePlaylistTracksResponse(body),
      "playlist tracks",
    );
  }

  async startPlayback(options: SpotifyStartPlaybackOptions): Promise<void> {
    const parameters = optionalDeviceParameters(options.deviceId);
    const positionMs =
      options.positionMs === undefined
        ? undefined
        : requireNonNegativeInteger(
            options.positionMs,
            "Playback position must be a non-negative whole number.",
          );

    let body: Record<string, unknown>;
    if ("uri" in options && typeof options.uri === "string") {
      body = {
        uris: [requireSpotifyTrackUri(options.uri)],
        ...(positionMs === undefined ? {} : { position_ms: positionMs }),
      };
    } else if (
      "contextUri" in options &&
      typeof options.contextUri === "string"
    ) {
      const contextUri = requireSpotifyContextUri(options.contextUri);
      const offset =
        options.offset === undefined
          ? undefined
          : parsePlaybackOffset(options.offset, contextUri);
      body = {
        context_uri: contextUri,
        ...(offset === undefined ? {} : { offset }),
        ...(positionMs === undefined ? {} : { position_ms: positionMs }),
      };
    } else {
      throw invalidRequest(
        "Choose a Spotify track or context before starting playback.",
        "Choose a track or playlist and try again.",
      );
    }

    await this.request(
      `/me/player/play${toQuerySuffix(parameters)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
        signal: options.signal,
      },
      "player",
    );
  }

  async addToQueue(
    uri: string,
    options: SpotifyQueueOptions = {},
  ): Promise<void> {
    const normalizedUri = requireSpotifyQueueUri(uri);
    const parameters = optionalDeviceParameters(options.deviceId);
    parameters.set("uri", normalizedUri);

    await this.request(
      `/me/player/queue?${parameters.toString()}`,
      {
        method: "POST",
        signal: options.signal,
      },
      "player",
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    context: SpotifyRequestContext = "library",
  ): Promise<Record<string, unknown> | null> {
    let token: string;
    try {
      token = await this.getAccessToken();
      if (!token.trim()) {
        throw new Error("Empty access token.");
      }
    } catch (cause) {
      throw new SpotifyApiError({
        code: "authentication",
        message: "Spotify authorization could not be refreshed.",
        action: "Sign in to Spotify again.",
        cause,
      });
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw cause;
      }
      throw new SpotifyApiError({
        code: "network",
        message: "Aura Player could not reach Spotify.",
        action: "Check the network and try again.",
        cause,
      });
    }

    if (!response.ok) {
      throw await responseToSpotifyError(response, context);
    }
    if (response.status === 204) {
      return null;
    }

    try {
      const result: unknown = await response.json();
      return isRecord(result) ? result : null;
    } catch (cause) {
      throw new SpotifyApiError({
        code: "invalid-response",
        message: "Spotify returned a response Aura Player could not read.",
        action: "Try again.",
        status: response.status,
        cause,
      });
    }
  }
}

type SpotifyRequestContext = "library" | "player";

interface PagingLimits {
  defaultLimit: number;
  maximumLimit: number;
}

function validatePaging(
  options: SpotifyPagingOptions,
  limits: PagingLimits,
): { limit: number; offset: number } {
  const limit = options.limit ?? limits.defaultLimit;
  const offset = options.offset ?? 0;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > limits.maximumLimit
  ) {
    throw invalidRequest(
      `Spotify page size must be between 1 and ${limits.maximumLimit}.`,
      "Use a supported whole-number page size.",
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw invalidRequest(
      "Spotify page offset must be a non-negative whole number.",
      "Return to the first page and try again.",
    );
  }

  return { limit, offset };
}

function optionalDeviceParameters(deviceId?: string): URLSearchParams {
  const parameters = new URLSearchParams();
  if (deviceId === undefined) {
    return parameters;
  }

  const normalizedId = deviceId.trim();
  if (!normalizedId) {
    throw new SpotifyApiError({
      code: "no-active-device",
      message: "Choose a Spotify device before starting playback.",
      action: "Open Available Devices and select a device.",
    });
  }
  parameters.set("device_id", normalizedId);
  return parameters;
}

function requireSpotifyTrackUri(uri: string): string {
  const normalized = uri.trim();
  if (!/^spotify:track:[A-Za-z0-9]+$/u.test(normalized)) {
    throw invalidRequest(
      "Spotify returned a track Aura Player cannot play.",
      "Choose another track.",
    );
  }
  return normalized;
}

function requireSpotifyQueueUri(uri: string): string {
  const normalized = uri.trim();
  if (!/^spotify:(?:episode|track):[A-Za-z0-9]+$/u.test(normalized)) {
    throw invalidRequest(
      "Spotify returned an item Aura Player cannot queue.",
      "Choose another track or episode.",
    );
  }
  return normalized;
}

function requireSpotifyContextUri(uri: string): string {
  const normalized = uri.trim();
  if (!/^spotify:(?:album|artist|playlist):[A-Za-z0-9]+$/u.test(normalized)) {
    throw invalidRequest(
      "Spotify returned a playback context Aura Player cannot use.",
      "Choose an album, artist, or playlist.",
    );
  }
  return normalized;
}

function parsePlaybackOffset(
  offset: NonNullable<SpotifyStartPlaybackOptions["offset"]>,
  contextUri: string,
): { position: number } | { uri: string } {
  if ("position" in offset) {
    if (contextUri.startsWith("spotify:artist:")) {
      throw invalidRequest(
        "Spotify does not support a position offset for artist playback.",
        "Start the artist context without choosing a position.",
      );
    }
    return {
      position: requireNonNegativeInteger(
        offset.position,
        "Playback offset must be a non-negative whole number.",
      ),
    };
  }

  if (contextUri.startsWith("spotify:artist:")) {
    throw invalidRequest(
      "Spotify does not support a track offset for artist playback.",
      "Start the artist context without choosing a track.",
    );
  }
  return { uri: requireSpotifyTrackUri(offset.uri) };
}

function requireNonNegativeInteger(value: number, message: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidRequest(message, "Choose a valid playback position.");
  }
  return value;
}

function requireValue(value: string, message: string, action: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw invalidRequest(message, action);
  }
  return normalized;
}

function invalidRequest(message: string, action: string): SpotifyApiError {
  return new SpotifyApiError({
    code: "invalid-request",
    message,
    action,
  });
}

function requireValidLibraryResponse<Value>(
  value: Value | null,
  resource: string,
): Value {
  if (value === null) {
    throw new SpotifyApiError({
      code: "invalid-response",
      message: `Spotify returned an invalid ${resource} response.`,
      action: "Try again.",
    });
  }
  return value;
}

function toQuerySuffix(parameters: URLSearchParams): string {
  const query = parameters.toString();
  return query ? `?${query}` : "";
}

function parseDevice(value: unknown): SpotifyDevice | null {
  if (!isRecord(value) || typeof value.name !== "string") {
    return null;
  }

  const volumePercent =
    typeof value.volume_percent === "number" &&
    Number.isFinite(value.volume_percent)
      ? Math.min(100, Math.max(0, Math.round(value.volume_percent)))
      : null;

  return {
    id: typeof value.id === "string" ? value.id : null,
    isActive: value.is_active === true,
    isPrivateSession: value.is_private_session === true,
    isRestricted: value.is_restricted === true,
    name: value.name,
    type: typeof value.type === "string" ? value.type : "Unknown",
    volumePercent,
    supportsVolume: value.supports_volume === true,
  };
}

async function responseToSpotifyError(
  response: Response,
  context: SpotifyRequestContext,
): Promise<SpotifyApiError> {
  let message: string | undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      message =
        typeof body.error.message === "string"
          ? body.error.message
          : undefined;
    }
  } catch {
    // Status-specific user guidance remains available without a JSON body.
  }

  if (response.status === 401) {
    return new SpotifyApiError({
      code: "authentication",
      message: message ?? "Spotify authorization expired.",
      action: "Sign in to Spotify again.",
      status: response.status,
    });
  }
  if (response.status === 403) {
    if (context !== "player") {
      return new SpotifyApiError({
        code: "rejected",
        message:
          message ??
          "Spotify did not allow Aura Player to access that library item.",
        action: "Check the Spotify account permissions and try again.",
        status: response.status,
      });
    }
    return new SpotifyApiError({
      code: "premium-required",
      message:
        message ??
        "Spotify rejected playback. Premium and the playback scope are required.",
      action: "Confirm the account has Premium and reconnect Spotify.",
      status: response.status,
    });
  }
  if (response.status === 404 && context === "player") {
    return new SpotifyApiError({
      code: "no-active-device",
      message: message ?? "No active Spotify device is available.",
      action: "Refresh Available Devices and choose another device.",
      status: response.status,
    });
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfter =
      retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter >= 0;
    return new SpotifyApiError({
      code: "rate-limited",
      message: message ?? "Spotify is temporarily rate limiting requests.",
      action: hasRetryAfter
        ? `Try again in ${retryAfter} seconds.`
        : "Try again shortly.",
      status: response.status,
      retryAfterSeconds: hasRetryAfter ? retryAfter : null,
    });
  }

  return new SpotifyApiError({
    code: "rejected",
    message: message ?? `Spotify rejected the request (${response.status}).`,
    action: "Try again or choose another playback device.",
    status: response.status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
