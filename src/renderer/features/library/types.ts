export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  uri: string;
  images: SpotifyImage[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  durationMs: number;
  explicit: boolean;
  isPlayable: boolean | null;
  isLocal: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}

export interface SpotifyPlaylistOwner {
  id: string;
  displayName: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  uri: string;
  images: SpotifyImage[];
  owner: SpotifyPlaylistOwner;
  itemCount: number;
  collaborative: boolean;
  public: boolean | null;
}

export interface SpotifySavedTrack {
  addedAt: string;
  track: SpotifyTrack;
}

export interface SpotifyPlaylistTrack {
  addedAt: string | null;
  isLocal: boolean;
  track: SpotifyTrack;
}

export interface SpotifyPage<Item> {
  items: Item[];
  limit: number;
  offset: number;
  total: number;
  nextOffset: number | null;
  previousOffset: number | null;
}

export type SpotifyTrackPage = SpotifyPage<SpotifyTrack>;
export type SpotifySavedTrackPage = SpotifyPage<SpotifySavedTrack>;
export type SpotifyPlaylistPage = SpotifyPage<SpotifyPlaylist>;
export type SpotifyPlaylistTrackPage = SpotifyPage<SpotifyPlaylistTrack>;

export interface SpotifyPagingOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export type SpotifyPlaybackOffset =
  | { position: number }
  | { uri: string };

interface SpotifyStartPlaybackBase {
  deviceId?: string;
  positionMs?: number;
  signal?: AbortSignal;
}

export interface SpotifyStartTrackPlaybackOptions
  extends SpotifyStartPlaybackBase {
  uri: string;
  contextUri?: never;
  offset?: never;
}

export interface SpotifyStartContextPlaybackOptions
  extends SpotifyStartPlaybackBase {
  contextUri: string;
  offset?: SpotifyPlaybackOffset;
  uri?: never;
}

export type SpotifyStartPlaybackOptions =
  | SpotifyStartTrackPlaybackOptions
  | SpotifyStartContextPlaybackOptions;

export interface SpotifyQueueOptions {
  deviceId?: string;
  signal?: AbortSignal;
}
