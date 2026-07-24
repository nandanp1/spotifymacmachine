import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  Laptop,
  LoaderCircle,
  Sparkles,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  AppSettings,
  AuthState,
  ImportedLrcFile,
  ImportedLrcRecord,
  LyricsTrackIdentity,
} from "../shared/types";
import { ArtworkStage } from "./components/ArtworkStage";
import { CinematicBackdrop } from "./components/CinematicBackdrop";
import {
  ConnectionPanel,
  type ConnectionState,
} from "./components/ConnectionPanel";
import {
  DevicePopover,
  type AuraDevice,
} from "./components/DevicePopover";
import { LibraryDrawer } from "./components/LibraryDrawer";
import { LyricsPanel } from "./components/LyricsPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Transport } from "./components/Transport";
import { DEMO_TRACKS, type DemoTrack } from "./demo-data";
import { SpotifyApiClient } from "./features/devices/spotify-api";
import {
  toSpotifyOpenUrl,
  type SpotifyTrack,
} from "./features/library";
import { parseLrcLyrics } from "./features/lyrics/lrc";
import {
  LocalLrcProvider,
  type LocalLrcEntry,
} from "./features/lyrics/providers";
import type { LyricsResult } from "./features/lyrics/types";
import { SpotifyPlaybackService } from "./features/player/spotify-playback-service";
import {
  getEstimatedAuraPosition,
  usePlayerStore,
  type AuraTrack,
} from "./stores/player-store";
import { useSettingsStore } from "./stores/settings-store";

interface ImportedLyrics {
  trackId: string;
  file: ImportedLrcFile;
  lyrics: LyricsResult;
}

interface ToastMessage {
  id: number;
  message: string;
  tone: "info" | "warning";
}

const SPOTIFY_IDLE_TRACK: DemoTrack = {
  id: "aura-spotify-idle",
  uri: "",
  title: "Choose a track",
  artist: "Spotify is ready",
  artists: ["Spotify is ready"],
  album: "Open your library or continue from another device",
  artworkUrl: null,
  source: "spotify",
  durationMs: 1,
  year: "LIVE",
  folio: "AURA / READY",
  artworkClass: "artwork--remote",
  palette: {
    shadow: "#080b0b",
    primary: "#243c39",
    accent: "#b76f56",
    highlight: "#d9c899",
  },
  lyrics: null,
};

export function App() {
  const player = usePlayerStore();
  const settings = useSettingsStore();
  const playbackServiceRef = useRef<SpotifyPlaybackService | null>(null);
  const activityTimerRef = useRef<number | null>(null);
  const didInitializeDemoRef = useRef(false);
  const didApplyLyricsPreferenceRef = useRef(false);
  const toastSequenceRef = useRef(0);
  const localLyricsProvider = useMemo(
    () =>
      new LocalLrcProvider(
        [],
        hasDesktopApi() ? window.aura.lyrics : undefined,
      ),
    [],
  );

  const [authState, setAuthState] = useState<AuthState>({ status: "signedOut" });
  const [authResolved, setAuthResolved] = useState(() => !hasDesktopApi());
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("preview");
  const [connectionError, setConnectionError] = useState<string>();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cacheSizeBytes, setCacheSizeBytes] = useState<
    number | null | undefined
  >(undefined);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<AuraDevice[]>([]);
  const [deviceLoadState, setDeviceLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [deviceError, setDeviceError] = useState<string>();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [demoTrackIndex, setDemoTrackIndex] = useState(0);
  const [positionMs, setPositionMs] = useState(43_000);
  const [importedLyrics, setImportedLyrics] = useState<ImportedLyrics | null>(
    null,
  );
  const [importedLyricsRecords, setImportedLyricsRecords] = useState<
    ImportedLrcRecord[]
  >([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const connected = authState.status === "authenticated";
  const spotifyApiClient = useMemo(
    () => (hasDesktopApi() ? createSpotifyApiClient() : null),
    [],
  );
  const hasOverlay =
    connectionOpen || libraryOpen || settingsOpen || devicesOpen;

  const liveDisplayTrack = useMemo(
    () => (player.track?.source === "spotify" ? toDisplayTrack(player.track) : null),
    [player.track],
  );
  const currentDemo =
    DEMO_TRACKS.find((track) => track.id === player.track?.id) ??
    DEMO_TRACKS[demoTrackIndex] ??
    DEMO_TRACKS[0];
  const displayTrack =
    liveDisplayTrack ??
    (player.source === "spotify" ? SPOTIFY_IDLE_TRACK : currentDemo);
  const displayLyrics =
    importedLyrics?.trackId === displayTrack.id
      ? importedLyrics.lyrics
      : displayTrack.lyrics;
  const lyricsIdentity = useMemo<LyricsTrackIdentity>(
    () => ({
      spotifyTrackId: displayTrack.id,
      title: displayTrack.title,
      artist: displayTrack.artist,
      album: displayTrack.album,
      durationMs: displayTrack.durationMs,
    }),
    [
      displayTrack.album,
      displayTrack.artist,
      displayTrack.durationMs,
      displayTrack.id,
      displayTrack.title,
    ],
  );

  const showToast = useCallback(
    (message: string, tone: ToastMessage["tone"] = "info") => {
      toastSequenceRef.current += 1;
      setToast({ id: toastSequenceRef.current, message, tone });
    },
    [],
  );

  const startSpotifyPlayback = useCallback(async () => {
    if (!hasDesktopApi()) {
      throw new Error("Spotify sign-in is available in the desktop build.");
    }
    if (playbackServiceRef.current) {
      return;
    }

    const service = new SpotifyPlaybackService({
      deviceName: settings.deviceName,
      initialVolume: player.volume,
      getOAuthToken: async () => {
        const token = await window.aura.auth.getWebPlaybackToken();
        return token.accessToken;
      },
    });
    playbackServiceRef.current = service;

    try {
      await player.connect(service);
    } catch (error) {
      playbackServiceRef.current = null;
      try {
        await player.disconnect();
      } catch {
        // The original playback error is the useful one for the user.
      }
      throw error;
    }
  }, [player, settings.deviceName]);

  useEffect(() => {
    if (didInitializeDemoRef.current) return;
    didInitializeDemoRef.current = true;
    player.setDemoTrack(DEMO_TRACKS[0], {
      paused: false,
      positionMs: 43_000,
      volume: player.volume,
    });
  }, [player]);

  useEffect(() => {
    if (!settings.hydrated || didApplyLyricsPreferenceRef.current) return;
    didApplyLyricsPreferenceRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      setLyricsVisible(settings.showLyricsByDefault);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settings.hydrated, settings.showLyricsByDefault]);

  useEffect(() => {
    if (!hasDesktopApi()) return;

    let active = true;
    const applyAuthState = (state: AuthState) => {
      if (!active) return;
      setAuthState(state);
      setAuthResolved(true);
      if (state.status === "authenticated") {
        setConnectionState("connected");
        setConnectionError(undefined);
        return;
      }
      if (state.status === "signedOut") {
        setConnectionState("preview");
        setConnectionError(undefined);
        return;
      }

      setConnectionState("error");
      setConnectionError(readAuthFailure(state.reason));
      setConnectionOpen(true);
    };

    void window.aura.auth
      .getState()
      .then(applyAuthState)
      .catch((error) => {
        if (!active) return;
        setAuthResolved(true);
        setConnectionState("error");
        setConnectionError(readError(error));
        setConnectionOpen(true);
      });

    const unsubscribe = window.aura.auth.onStateChanged(applyAuthState);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasDesktopApi()) return;

    let active = true;
    void window.aura.lyrics
      .listImported()
      .then((records) => {
        if (active) setImportedLyricsRecords(records);
      })
      .catch(() => {
        if (active) setImportedLyricsRecords([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasDesktopApi()) return;
    const controller = new AbortController();
    const trackId = displayTrack.id;

    void window.aura.lyrics
      .matchImported(lyricsIdentity)
      .then(async (file) => {
        if (controller.signal.aborted) return;
        if (!file) {
          setImportedLyrics((current) =>
            current?.trackId === trackId ? null : current,
          );
          return;
        }

        localLyricsProvider.addEntry(toLocalLrcEntry(file));
        const lyrics = await localLyricsProvider.findLyrics(
          lyricsIdentity,
          controller.signal,
        );
        if (!lyrics || controller.signal.aborted) return;
        setImportedLyrics({ trackId, file, lyrics });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        showToast(
          `Saved lyrics for this track could not be loaded. ${readError(error)}`,
          "warning",
        );
      });

    return () => controller.abort();
  }, [
    displayTrack.id,
    localLyricsProvider,
    lyricsIdentity,
    showToast,
  ]);

  useEffect(() => {
    if (!settings.hydrated || !connected || playbackServiceRef.current) return;
    void startSpotifyPlayback().catch((error) => {
      setConnectionError(readError(error));
      setConnectionState("error");
      showToast("Spotify is signed in, but playback could not initialize.", "warning");
    });
  }, [connected, settings.hydrated, showToast, startSpotifyPlayback]);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    if (!hasDesktopApi()) {
      setCacheSizeBytes(0);
      return;
    }

    setCacheSizeBytes(null);
    void window.aura.cache
      .getInfo()
      .then(({ sizeBytes }) => {
        setCacheSizeBytes(sizeBytes);
      })
      .catch(() => {
        setCacheSizeBytes(undefined);
      });
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      setPositionMs(getEstimatedAuraPosition(player, Date.now()));
    };
    updatePosition();
    const timer = window.setInterval(updatePosition, player.isPlaying ? 180 : 800);
    return () => window.clearInterval(timer);
  }, [player]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!player.problem) return;
    showToast(
      `${player.problem.message}${player.problem.action ? ` ${player.problem.action}` : ""}`,
      "warning",
    );
  }, [player.problem, showToast]);

  useEffect(() => {
    if (!hasDesktopApi() || !displayTrack) return;
    void window.aura.menu.updateNowPlaying({
      title: displayTrack.title,
      artist: displayTrack.artist,
      isPlaying: player.isPlaying,
    });
  }, [displayTrack, player.isPlaying]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (activityTimerRef.current !== null) {
      window.clearTimeout(activityTimerRef.current);
      activityTimerRef.current = null;
    }
    if (settings.hideControlsAutomatically && !hasOverlay) {
      activityTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        activityTimerRef.current = null;
      }, 3_800);
    }
  }, [hasOverlay, settings.hideControlsAutomatically]);

  useEffect(() => {
    if (hasOverlay) {
      if (activityTimerRef.current !== null) {
        window.clearTimeout(activityTimerRef.current);
        activityTimerRef.current = null;
      }
      return;
    }
    const frame = window.requestAnimationFrame(revealControls);
    return () => window.cancelAnimationFrame(frame);
  }, [hasOverlay, revealControls]);

  useEffect(
    () => () => {
      if (activityTimerRef.current !== null) {
        window.clearTimeout(activityTimerRef.current);
      }
    },
    [],
  );

  const chooseDemoTrack = useCallback(
    async (index: number) => {
      const normalized = (index + DEMO_TRACKS.length) % DEMO_TRACKS.length;
      const track = DEMO_TRACKS[normalized];
      if (!track) return;

      if (player.source === "spotify") {
        await player.disconnect();
        playbackServiceRef.current = null;
      }
      setDemoTrackIndex(normalized);
      player.setDemoTrack(track, {
        paused: !player.isPlaying,
        volume: player.volume,
      });
      setPositionMs(0);
      setLibraryOpen(false);
    },
    [player],
  );

  const handlePlayPause = useCallback(() => {
    void player.togglePlayback().catch((error) => {
      showToast(readError(error), "warning");
    });
  }, [player, showToast]);

  const handleNext = useCallback(() => {
    if (player.source === "demo") {
      const index = DEMO_TRACKS.findIndex((track) => track.id === player.track?.id);
      void chooseDemoTrack(index < 0 ? 0 : index + 1);
      return;
    }
    void player.next().catch((error) => showToast(readError(error), "warning"));
  }, [chooseDemoTrack, player, showToast]);

  const handlePrevious = useCallback(() => {
    if (player.source === "demo") {
      if (positionMs > 5_000) {
        void player.seek(0);
        return;
      }
      const index = DEMO_TRACKS.findIndex((track) => track.id === player.track?.id);
      void chooseDemoTrack(index < 0 ? 0 : index - 1);
      return;
    }
    void player
      .previous()
      .catch((error) => showToast(readError(error), "warning"));
  }, [chooseDemoTrack, player, positionMs, showToast]);

  const handleSeek = useCallback(
    (nextPosition: number) => {
      void player
        .seek(nextPosition)
        .catch((error) => showToast(readError(error), "warning"));
    },
    [player, showToast],
  );

  const handleVolume = useCallback(
    (volume: number) => {
      void player
        .setVolume(volume)
        .catch((error) => showToast(readError(error), "warning"));
    },
    [player, showToast],
  );

  const toggleFullscreen = useCallback(() => {
    if (hasDesktopApi()) {
      void window.aura.window.toggleFullscreen();
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const unsubscribe = hasDesktopApi()
      ? window.aura.menu.onCommand((command) => {
          if (command === "playPause") handlePlayPause();
          if (command === "previous") handlePrevious();
          if (command === "next") handleNext();
        })
      : () => undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inEditableField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape") {
        if (connectionOpen || libraryOpen || settingsOpen || devicesOpen) {
          setConnectionOpen(false);
          setLibraryOpen(false);
          setSettingsOpen(false);
          setDevicesOpen(false);
        } else if (hasDesktopApi()) {
          void window.aura.window.setFullscreen(false);
        } else if (document.fullscreenElement) {
          void document.exitFullscreen();
        }
        revealControls();
        return;
      }

      if (inEditableField) return;

      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLibraryOpen(true);
      } else if (event.key === " ") {
        event.preventDefault();
        handlePlayPause();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.metaKey) handlePrevious();
        else handleSeek(Math.max(0, positionMs - 10_000));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.metaKey) handleNext();
        else handleSeek(Math.min(player.durationMs, positionMs + 10_000));
      } else if (!event.metaKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleFullscreen();
      } else if (!event.metaKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setLyricsVisible((visible) => !visible);
      }
      revealControls();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    connectionOpen,
    devicesOpen,
    handleNext,
    handlePlayPause,
    handlePrevious,
    handleSeek,
    libraryOpen,
    player.durationMs,
    positionMs,
    revealControls,
    settingsOpen,
    toggleFullscreen,
  ]);

  const handleConnect = useCallback(async () => {
    if (!hasDesktopApi()) {
      setConnectionState("error");
      setConnectionError("Run Aura through Electron to connect Spotify securely.");
      setConnectionOpen(true);
      return;
    }

    setConnectionOpen(true);
    setConnectionState("connecting");
    setConnectionError(undefined);
    try {
      const state = await window.aura.auth.signIn();
      setAuthState(state);
      if (state.status !== "authenticated") {
        throw new Error("Spotify did not return an authenticated session.");
      }
      setConnectionState("connected");
      await startSpotifyPlayback();
    } catch (error) {
      const message = readError(error);
      setConnectionError(message);
      setConnectionState(
        /cancel/i.test(message) ? "cancelled" : "error",
      );
    }
  }, [startSpotifyPlayback]);

  const handleSignOut = useCallback(async () => {
    try {
      await player.disconnect();
      playbackServiceRef.current = null;
      if (hasDesktopApi()) {
        const state = await window.aura.auth.signOut();
        setAuthState(state);
      } else {
        setAuthState({ status: "signedOut" });
      }
      setConnectionState("preview");
      player.setDemoTrack(DEMO_TRACKS[demoTrackIndex] ?? DEMO_TRACKS[0], {
        paused: false,
        volume: player.volume,
      });
      showToast("Spotify credentials were removed from this Mac.");
    } catch (error) {
      showToast(readError(error), "warning");
    }
  }, [demoTrackIndex, player, showToast]);

  const handleOpenDevices = useCallback(async () => {
    setDevicesOpen(true);
    if (!connected || !spotifyApiClient) return;

    setDeviceLoadState("loading");
    setDeviceError(undefined);
    try {
      const spotifyDevices = await spotifyApiClient.getAvailableDevices();
      setDevices(
        spotifyDevices
          .filter((device) => device.id !== null)
          .map((device) => ({
            id: device.id as string,
            name: device.name,
            type: mapDeviceType(device.type),
            isActive: device.isActive,
            available: !device.isRestricted,
          })),
      );
      setDeviceLoadState("ready");
    } catch (error) {
      const message = readError(error);
      setDeviceLoadState("error");
      setDeviceError(message);
      showToast(message, "warning");
    }
  }, [connected, showToast, spotifyApiClient]);

  const handleTransfer = useCallback(
    async (device: AuraDevice) => {
      try {
        if (!spotifyApiClient) {
          throw new Error("Connect Spotify before transferring playback.");
        }
        await spotifyApiClient.transferPlayback(device.id);
        setDevices((current) =>
          current.map((candidate) => ({
            ...candidate,
            isActive: candidate.id === device.id,
          })),
        );
        setDevicesOpen(false);
        showToast(`Playback transferred to ${device.name}.`);
      } catch (error) {
        showToast(readError(error), "warning");
      }
    },
    [showToast, spotifyApiClient],
  );

  const handlePlaySpotifyTrack = useCallback(
    async (track: SpotifyTrack, contextUri?: string) => {
      if (!spotifyApiClient) {
        throw new Error("Connect Spotify before choosing a live track.");
      }

      if (contextUri) {
        await spotifyApiClient.startPlayback({
          contextUri,
          offset: { uri: track.uri },
          deviceId: player.deviceId ?? undefined,
        });
      } else {
        await spotifyApiClient.startPlayback({
          uri: track.uri,
          deviceId: player.deviceId ?? undefined,
        });
      }

      setLibraryOpen(false);
      showToast(`Spotify accepted “${track.name}” for playback.`);
    },
    [player.deviceId, showToast, spotifyApiClient],
  );

  const handleQueueSpotifyTrack = useCallback(
    async (track: SpotifyTrack) => {
      if (!spotifyApiClient) {
        throw new Error("Connect Spotify before editing the queue.");
      }
      await spotifyApiClient.addToQueue(track.uri, {
        deviceId: player.deviceId ?? undefined,
      });
      showToast(`“${track.name}” was added to the Spotify queue.`);
    },
    [player.deviceId, showToast, spotifyApiClient],
  );

  const handleOpenSpotifyTrack = useCallback(
    async (track: SpotifyTrack) => {
      const url = toSpotifyOpenUrl(track.uri);
      if (!url || !hasDesktopApi()) {
        throw new Error("This track cannot be opened outside Aura Player.");
      }
      await window.aura.app.openExternal(url);
    },
    [],
  );

  const handleImportLrc = useCallback(async () => {
    if (!hasDesktopApi()) {
      showToast("Lyric import is available in the desktop build.", "warning");
      return;
    }

    let file: ImportedLrcFile | null = null;
    try {
      file = await window.aura.lyrics.importLrc(lyricsIdentity);
      if (!file) return;
      localLyricsProvider.addEntry(toLocalLrcEntry(file));
      const lyrics =
        (await localLyricsProvider.findLyrics(lyricsIdentity)) ??
        parseLrcLyrics(file.content, file.fileName);
      setImportedLyrics({ trackId: displayTrack.id, file, lyrics });
      setImportedLyricsRecords((current) => [
        file as ImportedLrcFile,
        ...current.filter((record) => record.id !== file?.id),
      ]);
      setLyricsVisible(true);
      setLibraryOpen(false);
      showToast(`${file.fileName} is now synced to ${displayTrack.title}.`);
    } catch (error) {
      if (file && hasDesktopApi()) {
        void window.aura.lyrics.deleteImported(file.id);
        localLyricsProvider.removeEntry(file.id);
      }
      showToast(readError(error), "warning");
    }
  }, [
    displayTrack.id,
    displayTrack.title,
    localLyricsProvider,
    lyricsIdentity,
    showToast,
  ]);

  const handleRemoveImportedLyrics = useCallback(
    async (id: string) => {
      try {
        const result = hasDesktopApi()
          ? await localLyricsProvider.deletePersistedEntry(id)
          : { deleted: false };
        setImportedLyricsRecords((current) =>
          current.filter((record) => record.id !== id),
        );
        setImportedLyrics((current) =>
          current?.file.id === id ? null : current,
        );
        showToast(
          result.deleted
            ? "Imported lyrics were removed from this Mac."
            : "Imported lyrics were removed from this session.",
        );
      } catch (error) {
        showToast(readError(error), "warning");
      }
    },
    [localLyricsProvider, showToast],
  );

  const handleSettingChange = useCallback(
    <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
      void settings.updateSetting(key, value);
    },
    [settings],
  );

  const handleClearCache = useCallback(() => {
    if (!hasDesktopApi()) {
      showToast("The preview has no artwork cache to clear.");
      setCacheSizeBytes(0);
      return;
    }
    void window.aura.cache
      .clear()
      .then(() => {
        setCacheSizeBytes(0);
        showToast("Local web cache cleared.");
      })
      .catch((error) => showToast(readError(error), "warning"));
  }, [showToast]);

  const appStyle = {
    "--track-shadow": displayTrack.palette.shadow,
    "--track-primary": displayTrack.palette.primary,
    "--track-accent": displayTrack.palette.accent,
    "--track-highlight": displayTrack.palette.highlight,
    "--text-scale": settings.textScale,
    "--background-blur": settings.backgroundBlur,
  } as CSSProperties;

  const transportDuration =
    player.durationMs > 1 ? player.durationMs : displayTrack.durationMs;
  const chromeVisible = controlsVisible || hasOverlay;

  return (
    <div
      className={`aura-app ${player.paused ? "is-paused" : ""} ${
        chromeVisible ? "" : "is-idle"
      }`}
      style={appStyle}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onFocusCapture={revealControls}
    >
      <CinematicBackdrop
        track={displayTrack}
        playing={player.isPlaying}
        buffering={player.buffering}
        positionMs={positionMs}
        intensity={settings.motionIntensity}
        mode={settings.visualMode}
      />

      <header className={`topbar ${chromeVisible ? "" : "chrome-hidden"}`}>
        <div className="brand" aria-label="Aura Player">
          <span className="brand__wordmark">AURA</span>
          <span className="brand__edition">
            {player.source === "spotify"
              ? player.connectionPhase === "ready"
                ? "Live listening room"
                : "Spotify session"
              : "Local design preview"}
          </span>
        </div>
        <button
          className="connection-pill"
          type="button"
          disabled={!authResolved}
          onClick={() => {
            if (connected) void handleOpenDevices();
            else setConnectionOpen(true);
          }}
          aria-label={
            connected
              ? "Open Spotify devices"
              : "Connect Aura Player to Spotify"
          }
        >
          {!authResolved || player.buffering ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : player.connectionPhase === "offline" ? (
            <WifiOff size={16} aria-hidden="true" />
          ) : (
            <Laptop size={16} aria-hidden="true" />
          )}
          <span className="connection-pill__status">
            <strong>
              {!authResolved
                ? "Checking Spotify"
                : connected
                ? player.connectionPhase === "ready"
                  ? settings.deviceName
                  : "Spotify connected"
                : "Design preview"}
            </strong>
            <small>
              {!authResolved
                ? "Reading the secure session"
                : connected
                ? readableConnectionPhase(player.connectionPhase)
                : "Not a Spotify device"}
            </small>
          </span>
          <span
            className={`status-orb ${
              player.connectionPhase === "ready" ? "status-orb--online" : ""
            }`}
            aria-hidden="true"
          />
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </header>

      <main className="main-stage">
        <ArtworkStage
          track={displayTrack}
          artworkScale={settings.artworkScale}
          onToggleFullscreen={toggleFullscreen}
        />
        <LyricsPanel
          lyrics={displayLyrics}
          positionMs={positionMs}
          offsetMs={settings.lyricOffsetMs}
          visible={lyricsVisible}
        />
      </main>

      <Transport
        visible={chromeVisible}
        playing={player.isPlaying}
        positionMs={Math.min(positionMs, transportDuration)}
        durationMs={transportDuration}
        volume={player.volume}
        onPlayPause={handlePlayPause}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onSeek={handleSeek}
        onVolume={handleVolume}
        onOpenLibrary={() => setLibraryOpen(true)}
        onOpenDevices={() => void handleOpenDevices()}
        onOpenSettings={handleOpenSettings}
      />

      <LibraryDrawer
        open={libraryOpen}
        connected={connected}
        tracks={DEMO_TRACKS}
        currentTrackId={displayTrack.id}
        client={spotifyApiClient}
        onClose={() => setLibraryOpen(false)}
        onChooseTrack={(track) => {
          const index = DEMO_TRACKS.findIndex((candidate) => candidate.id === track.id);
          void chooseDemoTrack(index);
        }}
        onPlaySpotifyTrack={handlePlaySpotifyTrack}
        onQueueSpotifyTrack={handleQueueSpotifyTrack}
        onOpenSpotifyTrack={handleOpenSpotifyTrack}
        onActionError={(error) => showToast(readError(error), "warning")}
        onConnect={handleConnect}
        onImportLrc={handleImportLrc}
      />

      <SettingsDrawer
        open={settingsOpen}
        connected={connected}
        accountLabel={connected ? "Spotify account connected" : undefined}
        settings={settings}
        importedLyrics={importedLyricsRecords}
        currentImportedLyricsId={importedLyrics?.file.id}
        cacheSizeBytes={cacheSizeBytes}
        onClose={() => setSettingsOpen(false)}
        onChange={handleSettingChange}
        onReset={() => void settings.resetSettings()}
        onImportLrc={handleImportLrc}
        onRemoveLrc={(id) => void handleRemoveImportedLyrics(id)}
        onClearCache={handleClearCache}
        onSignOut={handleSignOut}
        onConnect={handleConnect}
      />

      <DevicePopover
        open={devicesOpen}
        connected={connected}
        devices={devices}
        loadState={deviceLoadState}
        errorMessage={deviceError}
        onClose={() => setDevicesOpen(false)}
        onTransfer={handleTransfer}
        onRetry={() => void handleOpenDevices()}
        onConnect={() => {
          setDevicesOpen(false);
          void handleConnect();
        }}
      />

      <ConnectionPanel
        open={connectionOpen}
        state={connectionState}
        errorMessage={connectionError}
        onClose={() => setConnectionOpen(false)}
        onConnect={handleConnect}
        onUsePreview={() => {
          setConnectionOpen(false);
          setConnectionState("preview");
        }}
      />

      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.id}
            className="toast-stack"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <div className="toast">
              {toast.tone === "warning" ? (
                <AlertTriangle size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {toast.message}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function hasDesktopApi() {
  return (
    typeof window !== "undefined" &&
    "aura" in window &&
    typeof window.aura?.auth?.getState === "function"
  );
}

function createSpotifyApiClient() {
  return new SpotifyApiClient({
    getAccessToken: async () => {
      const token = await window.aura.auth.getWebPlaybackToken();
      return token.accessToken;
    },
  });
}

function toDisplayTrack(track: AuraTrack): DemoTrack {
  const seed = hashString(track.id);
  const primaryHue = seed % 360;
  const accentHue = (primaryHue + 58 + (seed % 31)) % 360;
  return {
    ...track,
    year: "LIVE",
    folio: "AURA / LIVE",
    artworkClass: "artwork--remote",
    palette: {
      shadow: `hsl(${primaryHue} 22% 5%)`,
      primary: `hsl(${primaryHue} 32% 28%)`,
      accent: `hsl(${accentHue} 46% 56%)`,
      highlight: `hsl(${(accentHue + 24) % 360} 48% 76%)`,
    },
    lyrics: null,
  };
}

function toLocalLrcEntry(file: ImportedLrcFile): LocalLrcEntry {
  return {
    id: file.id,
    fileName: file.fileName,
    contents: file.content,
    spotifyTrackId: file.spotifyTrackId,
    isrc: file.isrc,
    title: file.title,
    artist: file.artist,
    album: file.album,
    durationMs: file.durationMs,
    importedAt: Date.parse(file.importedAt),
  };
}

function hashString(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function readError(error: unknown) {
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
  return error instanceof Error ? error.message : "Aura Player hit an unexpected problem.";
}

function readAuthFailure(
  reason: Extract<AuthState, { status: "expired" }>["reason"],
): string {
  if (reason === "configuration") {
    return "Spotify is not configured. Add the client ID and exact loopback redirect URI, then try again.";
  }
  if (reason === "keychain") {
    return "Aura Player could not read the Spotify session from macOS Keychain. Unlock Keychain or sign in again.";
  }
  if (reason === "network") {
    return "The saved Spotify session could not refresh while the network was unavailable. Reconnect and try again.";
  }
  if (reason === "refreshRejected") {
    return "Spotify no longer accepts the saved session. Sign in again to replace it.";
  }
  return "The saved Spotify session could not be restored. Sign in again.";
}

function mapDeviceType(type: string): AuraDevice["type"] {
  const normalized = type.toLowerCase();
  if (normalized.includes("phone") || normalized.includes("tablet")) {
    return "smartphone";
  }
  if (
    normalized.includes("speaker") ||
    normalized.includes("tv") ||
    normalized.includes("avr")
  ) {
    return "speaker";
  }
  return "computer";
}

function readableConnectionPhase(phase: string) {
  if (phase === "ready") return "Available in Spotify Connect";
  if (phase === "loading-sdk") return "Loading playback service";
  if (phase === "connecting") return "Registering this Mac";
  if (phase === "reconnecting") return "Reconnecting";
  if (phase === "offline") return "Network offline";
  if (phase === "unavailable") return "Playback unavailable";
  if (phase === "error") return "Needs attention";
  if (phase === "demo") return "Local preview active";
  return "Waiting for playback";
}
