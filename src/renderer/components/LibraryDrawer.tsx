import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  FileMusic,
  ListPlus,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DemoTrack } from "../demo-data";
import type { SpotifyApiClient } from "../features/devices/spotify-api";
import type {
  SpotifyPlaylist,
  SpotifyTrack,
} from "../features/library";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { formatDuration } from "../lib/format";
import { IconButton } from "./IconButton";

type LibraryTab = "tracks" | "saved" | "playlists";
type TrackAction = "play" | "queue" | "open";

interface LibraryDrawerProps {
  open: boolean;
  connected: boolean;
  tracks: DemoTrack[];
  currentTrackId: string;
  client: SpotifyApiClient | null;
  onClose: () => void;
  onChooseTrack: (track: DemoTrack) => void;
  onPlaySpotifyTrack: (
    track: SpotifyTrack,
    contextUri?: string,
  ) => Promise<void>;
  onQueueSpotifyTrack: (track: SpotifyTrack) => Promise<void>;
  onOpenSpotifyTrack: (track: SpotifyTrack) => Promise<void>;
  onActionError: (error: unknown) => void;
  onConnect: () => void;
  onImportLrc: () => void;
}

export function LibraryDrawer({
  open,
  connected,
  tracks,
  currentTrackId,
  client,
  onClose,
  onChooseTrack,
  onPlaySpotifyTrack,
  onQueueSpotifyTrack,
  onOpenSpotifyTrack,
  onActionError,
  onConnect,
  onImportLrc,
}: LibraryDrawerProps) {
  const [tab, setTab] = useState<LibraryTab>("tracks");
  const [query, setQuery] = useState("");
  const [searchOffset, setSearchOffset] = useState(0);
  const [savedOffset, setSavedOffset] = useState(0);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistTrackOffset, setPlaylistTrackOffset] = useState(0);
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<SpotifyPlaylist | null>(null);
  const [actionTrack, setActionTrack] = useState<SpotifyTrack | null>(null);
  const [pendingAction, setPendingAction] = useState<TrackAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useDialogFocus<HTMLElement>(open, inputRef);
  const deferredQuery = useDeferredValue(query.trim());

  const previewTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tracks;
    return tracks.filter((track) =>
      `${track.title} ${track.artist} ${track.album}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, tracks]);

  const search = useQuery({
    queryKey: ["spotify-library", "search", deferredQuery, searchOffset],
    queryFn: ({ signal }) =>
      requireClient(client).searchTracks(deferredQuery, {
        limit: 10,
        offset: searchOffset,
        signal,
      }),
    enabled:
      open &&
      connected &&
      client !== null &&
      tab === "tracks" &&
      deferredQuery.length > 0,
    retry: false,
  });

  const saved = useQuery({
    queryKey: ["spotify-library", "saved", savedOffset],
    queryFn: ({ signal }) =>
      requireClient(client).getSavedTracks({
        limit: 20,
        offset: savedOffset,
        signal,
      }),
    enabled:
      open && connected && client !== null && tab === "saved",
    retry: false,
  });

  const playlists = useQuery({
    queryKey: ["spotify-library", "playlists", playlistOffset],
    queryFn: ({ signal }) =>
      requireClient(client).getUserPlaylists({
        limit: 20,
        offset: playlistOffset,
        signal,
      }),
    enabled:
      open &&
      connected &&
      client !== null &&
      tab === "playlists" &&
      selectedPlaylist === null,
    retry: false,
  });

  const playlistTracks = useQuery({
    queryKey: [
      "spotify-library",
      "playlist-tracks",
      selectedPlaylist?.id,
      playlistTrackOffset,
    ],
    queryFn: ({ signal }) =>
      requireClient(client).getPlaylistTracks(
        selectedPlaylist?.id ?? "",
        {
          limit: 20,
          offset: playlistTrackOffset,
          signal,
        },
      ),
    enabled:
      open &&
      connected &&
      client !== null &&
      tab === "playlists" &&
      selectedPlaylist !== null,
    retry: false,
  });

  const liveTracks: SpotifyTrack[] =
    tab === "tracks"
      ? (search.data?.items ?? [])
      : tab === "saved"
        ? (saved.data?.items.map((entry) => entry.track) ?? [])
        : selectedPlaylist
          ? (playlistTracks.data?.items.map((entry) => entry.track) ?? [])
          : [];

  const activePage =
    tab === "tracks"
      ? search.data
      : tab === "saved"
        ? saved.data
        : selectedPlaylist
          ? playlistTracks.data
          : playlists.data;
  const loading =
    tab === "tracks"
      ? deferredQuery.length > 0 && search.isPending
      : tab === "saved"
        ? saved.isPending
        : selectedPlaylist
          ? playlistTracks.isPending
          : playlists.isPending;
  const fetching =
    tab === "tracks"
      ? search.isFetching
      : tab === "saved"
        ? saved.isFetching
        : selectedPlaylist
          ? playlistTracks.isFetching
          : playlists.isFetching;
  const error =
    tab === "tracks"
      ? search.error
      : tab === "saved"
        ? saved.error
        : selectedPlaylist
          ? playlistTracks.error
          : playlists.error;

  const selectTab = (nextTab: LibraryTab) => {
    setTab(nextTab);
    setSelectedPlaylist(null);
    setActionTrack(null);
  };

  const retry = () => {
    if (tab === "tracks") void search.refetch();
    if (tab === "saved") void saved.refetch();
    if (tab === "playlists" && selectedPlaylist) {
      void playlistTracks.refetch();
    }
    if (tab === "playlists" && !selectedPlaylist) {
      void playlists.refetch();
    }
  };

  const movePage = (offset: number) => {
    setActionTrack(null);
    if (tab === "tracks") setSearchOffset(offset);
    if (tab === "saved") setSavedOffset(offset);
    if (tab === "playlists" && selectedPlaylist) {
      setPlaylistTrackOffset(offset);
    }
    if (tab === "playlists" && !selectedPlaylist) {
      setPlaylistOffset(offset);
    }
  };

  const runTrackAction = async (
    action: TrackAction,
    track: SpotifyTrack,
    operation: () => Promise<void>,
  ) => {
    setPendingAction(action);
    setActionTrack(track);
    try {
      await operation();
      if (action !== "play") setActionTrack(null);
    } catch (actionError) {
      onActionError(actionError);
    } finally {
      setPendingAction(null);
    }
  };

  const heading = selectedPlaylist?.name ?? "Find the next room";

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            className="overlay-scrim"
            aria-label="Close library"
            type="button"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            ref={drawerRef}
            className="drawer drawer--library"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-title"
            initial={{ x: "-102%" }}
            animate={{ x: 0 }}
            exit={{ x: "-102%" }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="drawer__header">
              <div>
                <p className="eyebrow">
                  {selectedPlaylist ? "Playlist" : "Collection"}
                </p>
                <h2 id="library-title">{heading}</h2>
              </div>
              <IconButton label="Close library" quiet onClick={onClose}>
                <X size={19} />
              </IconButton>
            </header>

            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search tracks</span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder={
                  connected ? "Search Spotify" : "Search the Aura preview"
                }
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setSearchOffset(0);
                  if (connected) selectTab("tracks");
                }}
              />
              <kbd>⌘ K</kbd>
            </label>

            {!connected ? (
              <div className="preview-notice">
                <Sparkles size={16} aria-hidden="true" />
                <div>
                  <strong>Local preview collection</strong>
                  <p>
                    Connect Spotify to search your real library and playlists.
                  </p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={onConnect}
                >
                  Connect
                </button>
              </div>
            ) : null}

            <nav className="drawer-tabs" aria-label="Library sections">
              {(["tracks", "saved", "playlists"] as const).map((item) => (
                <button
                  key={item}
                  className={`drawer-tab ${
                    tab === item ? "drawer-tab--active" : ""
                  }`}
                  type="button"
                  disabled={!connected && item !== "tracks"}
                  aria-current={tab === item ? "page" : undefined}
                  onClick={() => selectTab(item)}
                >
                  {item === "tracks"
                    ? "Search"
                    : item === "saved"
                      ? "Saved"
                      : "Playlists"}
                </button>
              ))}
            </nav>

            <div
              className="track-list"
              aria-label={
                tab === "playlists" && !selectedPlaylist
                  ? "Spotify playlists"
                  : "Tracks"
              }
              aria-busy={fetching}
            >
              {!connected ? (
                <PreviewTrackList
                  tracks={previewTracks}
                  currentTrackId={currentTrackId}
                  onChooseTrack={onChooseTrack}
                />
              ) : loading ? (
                <LibraryState
                  icon={<LoaderCircle className="spin" size={20} />}
                  title="Opening your collection"
                  message="Spotify is preparing this room."
                />
              ) : error ? (
                <LibraryState
                  title="Spotify could not open this view"
                  message={readLibraryError(error)}
                  actionLabel="Try again"
                  onAction={retry}
                />
              ) : tab === "tracks" && deferredQuery.length === 0 ? (
                <LibraryState
                  title="Search the catalog"
                  message="Enter a track, artist, or album. Nothing plays until you choose it."
                />
              ) : tab === "playlists" && !selectedPlaylist ? (
                <PlaylistList
                  playlists={playlists.data?.items ?? []}
                  onChoose={(playlist) => {
                    setSelectedPlaylist(playlist);
                    setPlaylistTrackOffset(0);
                    setActionTrack(null);
                  }}
                />
              ) : liveTracks.length ? (
                <SpotifyTrackList
                  tracks={liveTracks}
                  currentTrackId={currentTrackId}
                  actionTrackId={actionTrack?.id ?? null}
                  pending={pendingAction !== null}
                  onPlay={(track) =>
                    void runTrackAction("play", track, () =>
                      onPlaySpotifyTrack(
                        track,
                        selectedPlaylist?.uri,
                      ),
                    )
                  }
                  onSelectAction={(track) =>
                    setActionTrack((current) =>
                      current?.id === track.id ? null : track,
                    )
                  }
                />
              ) : (
                <LibraryState
                  title={
                    tab === "tracks"
                      ? "No matching tracks"
                      : tab === "saved"
                        ? "No saved tracks here"
                        : "This playlist is quiet"
                  }
                  message={
                    tab === "tracks"
                      ? "Try a different title, artist, or album."
                      : "Spotify returned an empty collection for this view."
                  }
                />
              )}

              {connected && activePage ? (
                <PageControls
                  previousOffset={activePage.previousOffset}
                  nextOffset={activePage.nextOffset}
                  onMove={movePage}
                />
              ) : null}
            </div>

            <footer className="drawer__footer drawer__footer--library">
              {selectedPlaylist ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setSelectedPlaylist(null);
                    setActionTrack(null);
                  }}
                >
                  <ArrowLeft size={16} />
                  Playlists
                </button>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onImportLrc}
                >
                  <FileMusic size={16} />
                  Import .lrc
                </button>
              )}
              <button
                className="ghost-action"
                type="button"
                disabled={!connected || !actionTrack || pendingAction !== null}
                onClick={() => {
                  if (!actionTrack) return;
                  void runTrackAction("queue", actionTrack, () =>
                    onQueueSpotifyTrack(actionTrack),
                  );
                }}
              >
                {pendingAction === "queue" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ListPlus size={16} />
                )}
                Play next
              </button>
              <button
                className="ghost-action"
                type="button"
                disabled={!connected || !actionTrack || pendingAction !== null}
                onClick={() => {
                  if (!actionTrack) return;
                  void runTrackAction("open", actionTrack, () =>
                    onOpenSpotifyTrack(actionTrack),
                  );
                }}
              >
                <ArrowUpRight size={16} />
                Open in Spotify
              </button>
            </footer>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function PreviewTrackList({
  tracks,
  currentTrackId,
  onChooseTrack,
}: {
  tracks: DemoTrack[];
  currentTrackId: string;
  onChooseTrack: (track: DemoTrack) => void;
}) {
  if (!tracks.length) {
    return (
      <LibraryState
        title="No matching tracks"
        message="Try a title, artist, or album from this preview collection."
      />
    );
  }

  return tracks.map((track, index) => {
    const active = track.id === currentTrackId;
    return (
      <div
        className={`library-track ${
          active ? "library-track--active" : ""
        }`}
        key={track.id}
      >
        <button
          className="library-track__main"
          type="button"
          onClick={() => onChooseTrack(track)}
          aria-label={`Play ${track.title} by ${track.artist} in preview mode`}
        >
          <span
            className={`library-track__art ${track.artworkClass}`}
            aria-hidden="true"
          />
          <span className="library-track__index">
            {active ? <Check size={13} /> : padIndex(index)}
          </span>
          <TrackCopy
            title={track.title}
            subtitle={`${track.artist} · ${track.album}`}
          />
          <time>{formatDuration(track.durationMs)}</time>
        </button>
      </div>
    );
  });
}

function SpotifyTrackList({
  tracks,
  currentTrackId,
  actionTrackId,
  pending,
  onPlay,
  onSelectAction,
}: {
  tracks: SpotifyTrack[];
  currentTrackId: string;
  actionTrackId: string | null;
  pending: boolean;
  onPlay: (track: SpotifyTrack) => void;
  onSelectAction: (track: SpotifyTrack) => void;
}) {
  return tracks.map((track, index) => {
    const active = track.id === currentTrackId;
    const selected = track.id === actionTrackId;
    const unavailable = track.isPlayable === false;
    const image = track.album.images[0]?.url;
    const artists = track.artists.map((artist) => artist.name).join(", ");

    return (
      <div
        className={`library-track ${
          active ? "library-track--active" : ""
        } ${selected ? "library-track--selected" : ""}`}
        key={`${track.id}-${index}`}
      >
        <button
          className="library-track__main"
          type="button"
          disabled={unavailable || pending}
          onClick={() => onPlay(track)}
          aria-label={
            unavailable
              ? `${track.name} by ${artists} is unavailable`
              : `Play ${track.name} by ${artists}`
          }
        >
          <span className="library-track__art artwork--remote">
            {image ? <img src={image} alt="" loading="lazy" /> : null}
          </span>
          <span className="library-track__index">
            {active ? <Check size={13} /> : padIndex(index)}
          </span>
          <TrackCopy
            title={track.name}
            subtitle={`${artists} · ${track.album.name}`}
          />
          <time>{formatDuration(track.durationMs)}</time>
        </button>
        <IconButton
          label={`Actions for ${track.name}`}
          size="small"
          quiet
          disabled={unavailable || pending}
          aria-pressed={selected}
          onClick={() => onSelectAction(track)}
        >
          <MoreHorizontal size={17} />
        </IconButton>
      </div>
    );
  });
}

function PlaylistList({
  playlists,
  onChoose,
}: {
  playlists: SpotifyPlaylist[];
  onChoose: (playlist: SpotifyPlaylist) => void;
}) {
  if (!playlists.length) {
    return (
      <LibraryState
        title="No playlists here"
        message="Spotify returned an empty playlist collection."
      />
    );
  }

  return playlists.map((playlist) => {
    const image = playlist.images[0]?.url;
    return (
      <button
        className="library-playlist"
        type="button"
        key={playlist.id}
        onClick={() => onChoose(playlist)}
      >
        <span className="library-track__art artwork--remote">
          {image ? <img src={image} alt="" loading="lazy" /> : null}
        </span>
        <span>
          <strong>{playlist.name}</strong>
          <small>
            {playlist.itemCount} {playlist.itemCount === 1 ? "track" : "tracks"}
            {playlist.owner.displayName
              ? ` · ${playlist.owner.displayName}`
              : ""}
          </small>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    );
  });
}

function TrackCopy({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <span className="library-track__copy">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </span>
  );
}

function LibraryState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: React.ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="drawer-empty" role="status">
      {icon ?? <span className="empty-rule" />}
      <h3>{title}</h3>
      <p>{message}</p>
      {actionLabel && onAction ? (
        <button
          className="primary-button primary-button--compact"
          type="button"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function PageControls({
  previousOffset,
  nextOffset,
  onMove,
}: {
  previousOffset: number | null;
  nextOffset: number | null;
  onMove: (offset: number) => void;
}) {
  if (previousOffset === null && nextOffset === null) {
    return null;
  }

  return (
    <nav className="library-pagination" aria-label="Library pages">
      <button
        type="button"
        disabled={previousOffset === null}
        onClick={() => {
          if (previousOffset !== null) onMove(previousOffset);
        }}
      >
        <ChevronLeft size={14} />
        Previous
      </button>
      <button
        type="button"
        disabled={nextOffset === null}
        onClick={() => {
          if (nextOffset !== null) onMove(nextOffset);
        }}
      >
        Next
        <ArrowRight size={14} />
      </button>
    </nav>
  );
}

function requireClient(client: SpotifyApiClient | null): SpotifyApiClient {
  if (!client) {
    throw new Error("Connect Spotify before opening the live library.");
  }
  return client;
}

function readLibraryError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const action =
      "action" in error && typeof error.action === "string"
        ? ` ${error.action}`
        : "";
    return `${error.message}${action}`;
  }
  return "This Spotify view is temporarily unavailable. Try again.";
}

function padIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}
