import { z } from "zod";

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

export interface SpotifyPlaybackImage {
  url: string;
  width?: number;
  height?: number;
}

export interface SpotifyPlaybackTrack {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  album: {
    name: string;
    uri?: string;
    images: SpotifyPlaybackImage[];
  };
  durationMs: number;
  isPlayable?: boolean;
}

export interface SpotifyPlaybackRestrictions {
  pausing: boolean;
  resuming: boolean;
  seeking: boolean;
  skippingNext: boolean;
  skippingPrevious: boolean;
}

export type SpotifyCurrentlyPlayingType =
  | "track"
  | "episode"
  | "ad"
  | "unknown";

export type SpotifyRepeatMode = "off" | "context" | "track";

export interface SpotifyPlaybackSnapshot {
  device: SpotifyDevice;
  track: SpotifyPlaybackTrack | null;
  itemType: SpotifyCurrentlyPlayingType;
  isPlaying: boolean;
  progressMs: number | null;
  contextUri: string | null;
  repeatMode: SpotifyRepeatMode;
  shuffle: boolean;
  restrictions: SpotifyPlaybackRestrictions;
  timestamp: number;
}

export type SpotifyApiProblemCode =
  | "authentication"
  | "premium-required"
  | "no-active-device"
  | "rate-limited"
  | "quota-exceeded"
  | "network"
  | "rejected"
  | "invalid-request"
  | "invalid-response";

export class SpotifyApiError extends Error {
  readonly code: SpotifyApiProblemCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly reason: string | null;
  readonly action: string;
  override readonly cause?: unknown;

  constructor(options: {
    code: SpotifyApiProblemCode;
    message: string;
    action: string;
    status?: number;
    retryAfterSeconds?: number | null;
    reason?: string | null;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "SpotifyApiError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.reason = options.reason ?? null;
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
    this.fetchImplementation =
      options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
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
  ): Promise<SpotifyPlaybackSnapshot | null> {
    const body = await this.request(
      "/me/player",
      {
        method: "GET",
        signal,
      },
      "player",
    );
    if (body === null) {
      return null;
    }

    const playback = parseCurrentPlayback(body);
    if (playback === null) {
      throw new SpotifyApiError({
        code: "invalid-response",
        message: "Spotify returned an invalid playback response.",
        action: "Refresh playback state.",
      });
    }
    return playback;
  }

  async resumePlayback(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      `/me/player/play?${exactDeviceParameters(deviceId).toString()}`,
      {
        method: "PUT",
        signal,
      },
      "player",
    );
  }

  async pausePlayback(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      `/me/player/pause?${exactDeviceParameters(deviceId).toString()}`,
      {
        method: "PUT",
        signal,
      },
      "player",
    );
  }

  async skipToNext(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      `/me/player/next?${exactDeviceParameters(deviceId).toString()}`,
      {
        method: "POST",
        signal,
      },
      "player",
    );
  }

  async skipToPrevious(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      `/me/player/previous?${exactDeviceParameters(deviceId).toString()}`,
      {
        method: "POST",
        signal,
      },
      "player",
    );
  }

  async seekPlayback(
    deviceId: string,
    positionMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const parameters = exactDeviceParameters(deviceId);
    parameters.set(
      "position_ms",
      String(
        requireNonNegativeInteger(
          positionMs,
          "Playback position must be a non-negative whole number.",
        ),
      ),
    );
    await this.request(
      `/me/player/seek?${parameters.toString()}`,
      {
        method: "PUT",
        signal,
      },
      "player",
    );
  }

  async setPlaybackVolume(
    deviceId: string,
    volumePercent: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const parameters = exactDeviceParameters(deviceId);
    parameters.set(
      "volume_percent",
      String(requireVolumePercent(volumePercent)),
    );
    await this.request(
      `/me/player/volume?${parameters.toString()}`,
      {
        method: "PUT",
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
      if (cause instanceof SpotifyApiError) {
        throw cause;
      }
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

function exactDeviceParameters(deviceId: string): URLSearchParams {
  const normalizedId = deviceId.trim();
  if (!normalizedId) {
    throw new SpotifyApiError({
      code: "no-active-device",
      message: "Choose a Spotify device before controlling playback.",
      action: "Open Available Devices and select a device.",
    });
  }
  return new URLSearchParams({ device_id: normalizedId });
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

function requireVolumePercent(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw invalidRequest(
      "Spotify volume must be a whole number between 0 and 100.",
      "Choose a valid playback volume.",
    );
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

const optionalDimensionSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .optional();

const playbackImageSchema = z
  .object({
    url: z.string().url(),
    width: optionalDimensionSchema,
    height: optionalDimensionSchema,
  })
  .transform(
    (image): SpotifyPlaybackImage => ({
      url: image.url,
      ...(image.width === null || image.width === undefined
        ? {}
        : { width: image.width }),
      ...(image.height === null || image.height === undefined
        ? {}
        : { height: image.height }),
    }),
  );

const playbackTrackSchema = z
  .object({
    id: z.string().min(1).nullable(),
    uri: z.union([
      z.string().regex(/^spotify:track:[A-Za-z0-9]+$/u),
      z.string().regex(/^spotify:local:.+/u),
    ]),
    name: z.string(),
    duration_ms: z.number().int().nonnegative(),
    is_playable: z.boolean().optional(),
    artists: z.array(
      z.object({
        name: z.string(),
      }),
    ),
    album: z.object({
      name: z.string(),
      uri: z
        .string()
        .startsWith("spotify:album:")
        .nullable()
        .optional(),
      images: z.array(playbackImageSchema),
    }),
  })
  .superRefine((track, context) => {
    if (track.id === null && !track.uri.startsWith("spotify:local:")) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Only local Spotify files may omit a track ID.",
      });
    }
  })
  .transform(
    (track): SpotifyPlaybackTrack => ({
      id: track.id ?? track.uri,
      uri: track.uri,
      title: track.name,
      artists: track.artists.map((artist) => artist.name),
      album: {
        name: track.album.name,
        ...(track.album.uri === undefined || track.album.uri === null
          ? {}
          : { uri: track.album.uri }),
        images: track.album.images,
      },
      durationMs: track.duration_ms,
      ...(track.is_playable === undefined
        ? {}
        : { isPlayable: track.is_playable }),
    }),
  );

const playbackEnvelopeSchema = z.object({
  device: z.unknown(),
  repeat_state: z.enum(["off", "context", "track"]),
  shuffle_state: z.boolean(),
  context: z
    .object({
      uri: z.string().min(1),
    })
    .nullable(),
  timestamp: z.number().int().nonnegative(),
  progress_ms: z.number().int().nonnegative().nullable(),
  is_playing: z.boolean(),
  item: z.unknown().nullable(),
  currently_playing_type: z.string(),
  actions: z
    .object({
      pausing: z.boolean().optional(),
      resuming: z.boolean().optional(),
      seeking: z.boolean().optional(),
      skipping_next: z.boolean().optional(),
      skipping_prev: z.boolean().optional(),
    })
    .optional(),
});

function parseCurrentPlayback(value: unknown): SpotifyPlaybackSnapshot | null {
  const result = playbackEnvelopeSchema.safeParse(value);
  if (!result.success) {
    return null;
  }

  const device = parseDevice(result.data.device);
  if (device === null) {
    return null;
  }

  const itemType = parseCurrentlyPlayingType(
    result.data.currently_playing_type,
  );
  const trackResult =
    itemType === "track" && result.data.item !== null
      ? playbackTrackSchema.safeParse(result.data.item)
      : null;
  if (trackResult !== null && !trackResult.success) {
    return null;
  }

  const restrictions = result.data.actions;
  return {
    device,
    track: trackResult?.data ?? null,
    itemType,
    isPlaying: result.data.is_playing,
    progressMs: result.data.progress_ms,
    contextUri: result.data.context?.uri ?? null,
    repeatMode: result.data.repeat_state,
    shuffle: result.data.shuffle_state,
    restrictions: {
      pausing: restrictions?.pausing === true,
      resuming: restrictions?.resuming === true,
      seeking: restrictions?.seeking === true,
      skippingNext: restrictions?.skipping_next === true,
      skippingPrevious: restrictions?.skipping_prev === true,
    },
    timestamp: result.data.timestamp,
  };
}

function parseCurrentlyPlayingType(
  value: string,
): SpotifyCurrentlyPlayingType {
  if (value === "track" || value === "episode" || value === "ad") {
    return value;
  }
  return "unknown";
}

async function responseToSpotifyError(
  response: Response,
  context: SpotifyRequestContext,
): Promise<SpotifyApiError> {
  let message: string | undefined;
  let reason: string | undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      message =
        typeof body.error.message === "string"
          ? body.error.message
          : undefined;
      reason =
        typeof body.error.reason === "string"
          ? body.error.reason
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
    if (!isPremiumEligibilityError(message, reason)) {
      return new SpotifyApiError({
        code: "rejected",
        message:
          message ??
          "Spotify did not authorize that playback request.",
        action:
          "Reconnect Spotify, confirm playback permissions, and try again.",
        status: response.status,
        reason,
      });
    }
    return new SpotifyApiError({
      code: "premium-required",
      message:
        message ??
        "Spotify rejected playback. Premium and the playback scope are required.",
      action: "Confirm the account has Premium and reconnect Spotify.",
      status: response.status,
      reason,
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
    if (reason === "QUOTA_EXCEEDED") {
      return new SpotifyApiError({
        code: "quota-exceeded",
        message:
          message ??
          "Spotify API quota is exhausted for this application.",
        action:
          "Wait for Spotify's application quota to reset before reconnecting remote control.",
        status: response.status,
        reason,
      });
    }
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
      reason,
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

function isPremiumEligibilityError(
  message: string | undefined,
  reason: string | undefined,
): boolean {
  const detail = `${message ?? ""} ${reason ?? ""}`.toLowerCase();
  return (
    /\bpremium\b/.test(detail) ||
    /\bproduct(?:\s+|_|-)*(?:eligibility|restriction|required)\b/.test(
      detail,
    ) ||
    /\baccount(?:\s+|_|-)*(?:eligibility|ineligible|not(?:\s+|_|-)*eligible)\b/.test(
      detail,
    )
  );
}
