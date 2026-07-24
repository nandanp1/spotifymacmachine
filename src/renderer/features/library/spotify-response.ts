import { z } from "zod";

import type {
  SpotifyPage,
  SpotifyPlaylist,
  SpotifyPlaylistPage,
  SpotifyPlaylistTrack,
  SpotifyPlaylistTrackPage,
  SpotifySavedTrackPage,
  SpotifyTrack,
  SpotifyTrackPage,
} from "./types";

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nullableDimensionSchema = nonNegativeIntegerSchema.nullable();

const imageSchema = z
  .object({
    url: z.string().url(),
    height: nullableDimensionSchema,
    width: nullableDimensionSchema,
  })
  .transform((image) => ({
    url: image.url,
    height: image.height,
    width: image.width,
  }));

const artistSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    uri: z.string().startsWith("spotify:artist:"),
  })
  .transform((artist) => ({
    id: artist.id,
    name: artist.name,
    uri: artist.uri,
  }));

const albumSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    uri: z.string().startsWith("spotify:album:"),
    images: z.array(imageSchema),
  })
  .transform((album) => ({
    id: album.id,
    name: album.name,
    uri: album.uri,
    images: album.images,
  }));

const trackSchema: z.ZodType<SpotifyTrack> = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    uri: z.string().startsWith("spotify:track:"),
    duration_ms: nonNegativeIntegerSchema,
    explicit: z.boolean(),
    is_playable: z.boolean().optional(),
    is_local: z.boolean().optional(),
    artists: z.array(artistSchema),
    album: albumSchema,
    type: z.literal("track").optional(),
  })
  .transform((track) => ({
    id: track.id,
    name: track.name,
    uri: track.uri,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    isPlayable: track.is_playable ?? null,
    isLocal: track.is_local ?? false,
    artists: track.artists,
    album: track.album,
  }));

const playlistOwnerSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().nullable().optional(),
  })
  .transform((owner) => ({
    id: owner.id,
    displayName: owner.display_name ?? null,
  }));

const playlistSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
  uri: z.string().startsWith("spotify:playlist:"),
  images: z.array(imageSchema),
  owner: playlistOwnerSchema,
  items: z
    .object({
      total: nonNegativeIntegerSchema,
    })
    .optional(),
  tracks: z
    .object({
      total: nonNegativeIntegerSchema,
    })
    .optional(),
  collaborative: z.boolean(),
  public: z.boolean().nullable(),
});

const savedTrackSchema = z
  .object({
    added_at: z.string().min(1),
    track: trackSchema,
  })
  .transform((item) => ({
    addedAt: item.added_at,
    track: item.track,
  }));

const playlistTrackWrapperSchema = z.object({
  added_at: z.string().nullable().optional(),
  is_local: z.boolean().optional(),
  item: z.unknown().optional(),
  track: z.unknown().optional(),
});

const pageEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema,
  total: nonNegativeIntegerSchema,
  next: z.string().nullable(),
  previous: z.string().nullable(),
});

export function parseTrackSearchResponse(
  value: unknown,
): SpotifyTrackPage | null {
  const result = z
    .object({
      tracks: z.unknown(),
    })
    .safeParse(value);

  return result.success
    ? parsePage(result.data.tracks, (items) => trackSchema.array().safeParse(items))
    : null;
}

export function parseSavedTracksResponse(
  value: unknown,
): SpotifySavedTrackPage | null {
  return parsePage(value, (items) => savedTrackSchema.array().safeParse(items));
}

export function parsePlaylistsResponse(
  value: unknown,
): SpotifyPlaylistPage | null {
  return parsePage(value, parsePlaylists);
}

export function parsePlaylistTracksResponse(
  value: unknown,
): SpotifyPlaylistTrackPage | null {
  return parsePage(value, parsePlaylistTracks);
}

function parsePlaylists(
  values: unknown[],
): ItemParseResult<SpotifyPlaylist> {
  const parsed = playlistSchema.array().safeParse(values);
  if (!parsed.success) {
    return { success: false };
  }

  const playlists: SpotifyPlaylist[] = [];
  for (const playlist of parsed.data) {
    const itemCount = playlist.items?.total ?? playlist.tracks?.total;
    if (itemCount === undefined) {
      return { success: false };
    }

    playlists.push({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description ?? null,
      uri: playlist.uri,
      images: playlist.images,
      owner: playlist.owner,
      itemCount,
      collaborative: playlist.collaborative,
      public: playlist.public,
    });
  }

  return { success: true, data: playlists };
}

function parsePlaylistTracks(
  values: unknown[],
): ItemParseResult<SpotifyPlaylistTrack> {
  const wrappers = playlistTrackWrapperSchema.array().safeParse(values);
  if (!wrappers.success) {
    return { success: false };
  }

  const items: SpotifyPlaylistTrack[] = [];
  for (const wrapper of wrappers.data) {
    const candidate =
      wrapper.item === undefined ? wrapper.track : wrapper.item;
    if (candidate === null) {
      continue;
    }
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "type" in candidate &&
      candidate.type !== "track"
    ) {
      continue;
    }

    const track = trackSchema.safeParse(candidate);
    if (!track.success) {
      return { success: false };
    }

    items.push({
      addedAt: wrapper.added_at ?? null,
      isLocal: wrapper.is_local ?? track.data.isLocal,
      track: track.data,
    });
  }

  return { success: true, data: items };
}

function parsePage<Item>(
  value: unknown,
  parseItems: (items: unknown[]) => ItemParseResult<Item>,
): SpotifyPage<Item> | null {
  const envelope = pageEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return null;
  }

  const items = parseItems(envelope.data.items);
  if (!items.success) {
    return null;
  }

  const { limit, offset, total, next, previous } = envelope.data;
  return {
    items: items.data,
    limit,
    offset,
    total,
    nextOffset: next === null ? null : offset + limit,
    previousOffset: previous === null ? null : Math.max(0, offset - limit),
  };
}

type ItemParseResult<Item> =
  | { success: true; data: Item[] }
  | { success: false };
