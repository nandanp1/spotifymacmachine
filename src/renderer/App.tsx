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
import {
  LyricsPanel,
  type LyricsPanelStatus,
} from "./components/LyricsPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Transport } from "./components/Transport";
import { DEMO_TRACKS, type DemoTrack } from "./demo-data";
import {
  SpotifyApiClient,
  SpotifyApiError,
  type SpotifyDevice,
} from "./features/devices/spotify-api";
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
import { SpotifyRemotePlaybackService } from "./features/player/spotify-remote-playback-service";
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

interface LyricsLoadState {
  trackId: string;
  status: LyricsPanelStatus;
  errorMessage?: string;
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
  const disconnectPlayer = player.disconnect;
  const settings = useSettingsStore();
  const playbackServiceRef =
    useRef<SpotifyRemotePlaybackService | null>(null);
  const playbackStatusUnsubscribeRef = useRef<(() => void) | null>(null);
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
  const [selectedDevice, setSelectedDevice] = useState<AuraDevice | null>(null);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [deviceLoadState, setDeviceLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [deviceError, setDeviceError] = useState<string>();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [demoTrackIndex, setDemoTrackIndex] = useState(0);
  const [positionMs, setPositionMs] = useState(43_000);
  const [importedLyricsByTrack, setImportedLyricsByTrack] = useState<
    Record<string, ImportedLyrics>
  >({});
  const [importedLyricsRecords, setImportedLyricsRecords] = useState<
    ImportedLrcRecord[]
  >([]);
  const [lyricsLoadState, setLyricsLoadState] = useState<LyricsLoadState>({
    trackId: "",
    status: "loading",
  });
  const [lyricsRevision, setLyricsRevision] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const connected = authState.status === "authenticated";
  const remotePlaybackReady =
    connected &&
    selectedDevice !== null &&
    player.connectionPhase === "ready" &&
    player.deviceId === selectedDevice.id;
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
    (connected || player.source === "spotify"
      ? SPOTIFY_IDLE_TRACK
      : currentDemo);
  const displayTrackIdRef = useRef(displayTrack.id);
  const importedLyrics = importedLyricsByTrack[displayTrack.id] ?? null;
  const displayLyrics =
    importedLyrics?.lyrics ?? displayTrack.lyrics;
  const displayLyricsStatus: LyricsPanelStatus = displayLyrics
    ? "ready"
    : displayTrack.id === SPOTIFY_IDLE_TRACK.id
      ? "idle"
      : lyricsLoadState.trackId === displayTrack.id
        ? lyricsLoadState.status
        : "loading";
  const lyricsArtist = displayTrack.artists?.[0] ?? displayTrack.artist;
  const lyricsIdentity = useMemo<LyricsTrackIdentity>(
    () => ({
      spotifyTrackId: displayTrack.id,
      title: displayTrack.title,
      artist: lyricsArtist,
      album: displayTrack.album,
      durationMs: displayTrack.durationMs,
    }),
    [
      displayTrack.album,
      displayTrack.durationMs,
      displayTrack.id,
      displayTrack.title,
      lyricsArtist,
    ],
  );

  const showToast = useCallback(
    (message: string, tone: ToastMessage["tone"] = "info") => {
      toastSequenceRef.current += 1;
      setToast({ id: toastSequenceRef.current, message, tone });
    },
    [],
  );

  useEffect(() => {
    displayTrackIdRef.current = displayTrack.id;
  }, [displayTrack.id]);

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
      if (playbackServiceRef.current) {
        playbackStatusUnsubscribeRef.current?.();
        playbackStatusUnsubscribeRef.current = null;
        playbackServiceRef.current = null;
        setSelectedDevice(null);
        setPendingDeviceId(null);
        void disconnectPlayer().catch(() => {
          // The auth error remains the canonical recovery message.
        });
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
  }, [disconnectPlayer]);

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
    const trackId = displayTrack.id;
    if (!hasDesktopApi()) {
      const frame = window.requestAnimationFrame(() => {
        setLyricsLoadState({
          trackId,
          status: displayTrack.lyrics ? "ready" : "unavailable",
        });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const controller = new AbortController();

    void window.aura.lyrics
      .matchImported(lyricsIdentity)
      .then(async (file) => {
        if (controller.signal.aborted) return;
        if (!file) {
          setImportedLyricsByTrack((current) => {
            if (!(trackId in current)) {
              return current;
            }
            const next = { ...current };
            delete next[trackId];
            return next;
          });
          setLyricsLoadState({
            trackId,
            status: displayTrack.lyrics ? "ready" : "unavailable",
          });
          return;
        }

        localLyricsProvider.addEntry(toLocalLrcEntry(file));
        const lyrics = parseLrcLyrics(file.content, file.fileName);
        if (controller.signal.aborted) return;
        setImportedLyricsByTrack((current) => ({
          ...current,
          [trackId]: { trackId, file, lyrics },
        }));
        setLyricsLoadState({ trackId, status: "ready" });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = readError(error);
        setLyricsLoadState({
          trackId,
          status: displayTrack.lyrics ? "ready" : "error",
          ...(displayTrack.lyrics ? {} : { errorMessage: message }),
        });
        showToast(
          `Saved lyrics for this track could not be loaded. ${message}`,
          "warning",
        );
      });

    return () => controller.abort();
  }, [
    displayTrack.id,
    displayTrack.lyrics,
    localLyricsProvider,
    lyricsIdentity,
    lyricsRevision,
    showToast,
  ]);

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
      playbackStatusUnsubscribeRef.current?.();
      playbackStatusUnsubscribeRef.current = null;
    },
    [],
  );

  const chooseDemoTrack = useCallback(
    async (index: number) => {
      const normalized = (index + DEMO_TRACKS.length) % DEMO_TRACKS.length;
      const track = DEMO_TRACKS[normalized];
      if (!track) return;

      if (player.source === "spotify") {
        playbackStatusUnsubscribeRef.current?.();
        playbackStatusUnsubscribeRef.current = null;
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
    if (connected && !remotePlaybackReady) {
      setDevicesOpen(true);
      showToast("Choose the Spotify device Aura should control.", "warning");
      return;
    }
    void player.togglePlayback().catch((error) => {
      showToast(readError(error), "warning");
    });
  }, [connected, player, remotePlaybackReady, showToast]);

  const handleNext = useCallback(() => {
    if (connected && !remotePlaybackReady) {
      setDevicesOpen(true);
      showToast("Choose the Spotify device Aura should control.", "warning");
      return;
    }
    if (player.source === "demo") {
      const index = DEMO_TRACKS.findIndex((track) => track.id === player.track?.id);
      void chooseDemoTrack(index < 0 ? 0 : index + 1);
      return;
    }
    void player.next().catch((error) => showToast(readError(error), "warning"));
  }, [
    chooseDemoTrack,
    connected,
    player,
    remotePlaybackReady,
    showToast,
  ]);

  const handlePrevious = useCallback(() => {
    if (connected && !remotePlaybackReady) {
      setDevicesOpen(true);
      showToast("Choose the Spotify device Aura should control.", "warning");
      return;
    }
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
  }, [
    chooseDemoTrack,
    connected,
    player,
    positionMs,
    remotePlaybackReady,
    showToast,
  ]);

  const handleSeek = useCallback(
    (nextPosition: number) => {
      if (connected && !remotePlaybackReady) {
        setDevicesOpen(true);
        showToast("Choose the Spotify device Aura should control.", "warning");
        return;
      }
      void player
        .seek(nextPosition)
        .catch((error) => showToast(readError(error), "warning"));
    },
    [connected, player, remotePlaybackReady, showToast],
  );

  const handleVolume = useCallback(
    (volume: number) => {
      if (
        connected &&
        (!remotePlaybackReady || selectedDevice?.supportsVolume !== true)
      ) {
        showToast(
          remotePlaybackReady
            ? "The selected Spotify device does not expose volume control."
            : "Choose the Spotify device Aura should control.",
          "warning",
        );
        return;
      }
      void player
        .setVolume(volume)
        .catch((error) => showToast(readError(error), "warning"));
    },
    [
      connected,
      player,
      remotePlaybackReady,
      selectedDevice?.supportsVolume,
      showToast,
    ],
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

  const loadDevices = useCallback(async (): Promise<AuraDevice[]> => {
    if (!spotifyApiClient) {
      return [];
    }

    setDeviceLoadState("loading");
    setDeviceError(undefined);
    try {
      const nextDevices = (await spotifyApiClient.getAvailableDevices())
        .filter((device) => device.id !== null)
        .map(mapSpotifyDevice);
      setDevices(nextDevices);
      setDeviceLoadState("ready");
      return nextDevices;
    } catch (error) {
      const message = readError(error);
      setDeviceLoadState("error");
      setDeviceError(message);
      showToast(message, "warning");
      return [];
    }
  }, [showToast, spotifyApiClient]);

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
      setConnectionOpen(false);
      setDevicesOpen(true);
      showToast("Spotify connected. Choose the device Aura should control.");
      void loadDevices();
    } catch (error) {
      const message = readError(error);
      setConnectionError(message);
      setConnectionState(
        /cancel/i.test(message) ? "cancelled" : "error",
      );
    }
  }, [loadDevices, showToast]);

  const handleSignOut = useCallback(async () => {
    try {
      playbackStatusUnsubscribeRef.current?.();
      playbackStatusUnsubscribeRef.current = null;
      await player.disconnect();
      playbackServiceRef.current = null;
      setSelectedDevice(null);
      setPendingDeviceId(null);
      setDevices([]);
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
    if (!connected) return;
    await loadDevices();
  }, [connected, loadDevices]);

  const handleSelectDevice = useCallback(
    async (device: AuraDevice) => {
      if (pendingDeviceId !== null) return;
      setPendingDeviceId(device.id);
      try {
        if (!spotifyApiClient) {
          throw new Error("Connect Spotify before choosing a remote device.");
        }

        if (playbackServiceRef.current) {
          playbackStatusUnsubscribeRef.current?.();
          playbackStatusUnsubscribeRef.current = null;
          await player.disconnect();
          playbackServiceRef.current = null;
        }

        if (!device.isActive) {
          await spotifyApiClient.transferPlayback(device.id, { play: false });
        }

        const confirmed = await waitForActiveSpotifyDevice(
          spotifyApiClient,
          device.id,
        );
        const confirmedDevice = mapSpotifyDevice(confirmed.target);
        const service = new SpotifyRemotePlaybackService({
          api: spotifyApiClient,
          target: {
            id: confirmedDevice.id,
            name: confirmedDevice.name,
            isRestricted: !confirmedDevice.available,
            supportsVolume: confirmedDevice.supportsVolume,
            volumePercent: confirmed.target.volumePercent,
          },
        });

        playbackServiceRef.current = service;
        playbackStatusUnsubscribeRef.current = service.subscribeStatus(
          (status) => {
            if (
              status.phase === "unavailable" &&
              status.deviceId === null
            ) {
              setSelectedDevice((current) =>
                current?.id === device.id ? null : current,
              );
            }
          },
        );
        await player.connect(service);
        setSelectedDevice(confirmedDevice);
        setDevices(
          confirmed.devices
            .filter((candidate) => candidate.id !== null)
            .map(mapSpotifyDevice),
        );
        setDevicesOpen(false);
        setConnectionState("connected");
        setConnectionError(undefined);
        showToast(
          `Remote control connected to ${confirmedDevice.name}. Audio stays on that device.`,
        );
      } catch (error) {
        playbackStatusUnsubscribeRef.current?.();
        playbackStatusUnsubscribeRef.current = null;
        playbackServiceRef.current = null;
        setSelectedDevice(null);
        try {
          await player.disconnect();
        } catch {
          // Preserve the device-selection error as the useful message.
        }
        showToast(readError(error), "warning");
      } finally {
        setPendingDeviceId(null);
      }
    },
    [pendingDeviceId, player, showToast, spotifyApiClient],
  );

  const handlePlaySpotifyTrack = useCallback(
    async (track: SpotifyTrack, contextUri?: string) => {
      if (!spotifyApiClient) {
        throw new Error("Connect Spotify before choosing a live track.");
      }
      const deviceId =
        player.connectionPhase === "ready" ? selectedDevice?.id : undefined;
      if (!deviceId || player.deviceId !== deviceId) {
        throw new Error(
          "Choose the Spotify device Aura should control before playing a track.",
        );
      }
      await requireActiveSpotifyDevice(spotifyApiClient, deviceId);

      if (contextUri) {
        await spotifyApiClient.startPlayback({
          contextUri,
          offset: { uri: track.uri },
          deviceId,
        });
      } else {
        await spotifyApiClient.startPlayback({
          uri: track.uri,
          deviceId,
        });
      }

      setLibraryOpen(false);
      showToast(`Spotify accepted “${track.name}” for playback.`);
    },
    [
      player.connectionPhase,
      player.deviceId,
      selectedDevice?.id,
      showToast,
      spotifyApiClient,
    ],
  );

  const handleQueueSpotifyTrack = useCallback(
    async (track: SpotifyTrack) => {
      if (!spotifyApiClient) {
        throw new Error("Connect Spotify before editing the queue.");
      }
      const deviceId =
        player.connectionPhase === "ready" ? selectedDevice?.id : undefined;
      if (!deviceId || player.deviceId !== deviceId) {
        throw new Error(
          "Choose the Spotify device Aura should control before editing its queue.",
        );
      }
      await requireActiveSpotifyDevice(spotifyApiClient, deviceId);
      await spotifyApiClient.addToQueue(track.uri, {
        deviceId,
      });
      showToast(`“${track.name}” was added to the Spotify queue.`);
    },
    [
      player.connectionPhase,
      player.deviceId,
      selectedDevice?.id,
      showToast,
      spotifyApiClient,
    ],
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
    const importedForTrackId = displayTrack.id;
    const importedForTrackTitle = displayTrack.title;
    try {
      file = await window.aura.lyrics.importLrc(lyricsIdentity);
      if (!file) return;
      const importedFile = file;
      localLyricsProvider.addEntry(toLocalLrcEntry(importedFile));
      const lyrics = parseLrcLyrics(
        importedFile.content,
        importedFile.fileName,
      );
      setImportedLyricsByTrack((current) => ({
        ...current,
        [importedForTrackId]: {
          trackId: importedForTrackId,
          file: importedFile,
          lyrics,
        },
      }));
      if (displayTrackIdRef.current === importedForTrackId) {
        setLyricsLoadState({
          trackId: importedForTrackId,
          status: "ready",
        });
        setLyricsVisible(true);
      }
      setImportedLyricsRecords((current) => [
        importedFile,
        ...current.filter((record) => record.id !== importedFile.id),
      ]);
      setLibraryOpen(false);
      showToast(
        `${importedFile.fileName} is now synced to ${importedForTrackTitle}.`,
      );
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
        const removingCurrentLyrics =
          importedLyrics?.trackId === displayTrack.id &&
          importedLyrics.file.id === id;
        const result = hasDesktopApi()
          ? await localLyricsProvider.deletePersistedEntry(id)
          : { deleted: false };
        setImportedLyricsRecords((current) =>
          current.filter((record) => record.id !== id),
        );
        setImportedLyricsByTrack((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([, entry]) => entry.file.id !== id,
            ),
          ),
        );
        if (removingCurrentLyrics) {
          setLyricsLoadState({
            trackId: displayTrack.id,
            status: displayTrack.lyrics ? "ready" : "loading",
          });
          setLyricsRevision((revision) => revision + 1);
        }
        showToast(
          result.deleted
            ? "Imported lyrics were removed from this Mac."
            : "Imported lyrics were removed from this session.",
        );
      } catch (error) {
        showToast(readError(error), "warning");
      }
    },
    [
      displayTrack.id,
      displayTrack.lyrics,
      importedLyrics,
      localLyricsProvider,
      showToast,
    ],
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
            {connected
              ? selectedDevice
                ? "Spotify remote control"
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
                ? player.connectionPhase === "ready" && selectedDevice
                  ? selectedDevice.name
                  : "Spotify connected"
                : "Design preview"}
            </strong>
            <small>
              {!authResolved
                ? "Reading the secure session"
                : connected
                ? player.connectionPhase === "ready" && selectedDevice
                  ? `Audio on ${selectedDevice.name}`
                  : readableConnectionPhase(player.connectionPhase)
                : "Not a Spotify device"}
            </small>
          </span>
          <span
            className={`status-orb ${
              player.connectionPhase === "ready" && selectedDevice
                ? "status-orb--online"
                : ""
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
          trackKey={`${displayTrack.source}:${displayTrack.id}`}
          trackTitle={displayTrack.title}
          status={displayLyricsStatus}
          errorMessage={
            lyricsLoadState.trackId === displayTrack.id
              ? lyricsLoadState.errorMessage
              : undefined
          }
          onImport={hasDesktopApi() ? handleImportLrc : undefined}
        />
      </main>

      <Transport
        visible={chromeVisible}
        playbackEnabled={
          (!connected && player.source === "demo") ||
          remotePlaybackReady
        }
        volumeEnabled={
          (!connected && player.source === "demo") ||
          (remotePlaybackReady &&
            selectedDevice?.supportsVolume === true)
        }
        playing={player.isPlaying}
        restrictions={player.restrictions}
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
        accountLabel={
          connected
            ? selectedDevice
              ? `Remote control on ${selectedDevice.name}`
              : "Spotify connected · choose a device"
            : undefined
        }
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
        selectedDeviceId={selectedDevice?.id}
        pendingDeviceId={pendingDeviceId}
        onClose={() => setDevicesOpen(false)}
        onSelect={handleSelectDevice}
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
      try {
        const token = await window.aura.auth.getWebPlaybackToken();
        return token.accessToken;
      } catch (cause) {
        const message = readError(cause);
        if (/could not be reached|network/i.test(message)) {
          throw new SpotifyApiError({
            code: "network",
            message: "Aura Player could not refresh Spotify authorization.",
            action: "Check the network and try again.",
            cause,
          });
        }
        if (/keychain|accessed securely|secure session/i.test(message)) {
          throw new SpotifyApiError({
            code: "authentication",
            message:
              "Aura Player could not read the Spotify session from macOS Keychain.",
            action: "Unlock Keychain or reconnect Spotify.",
            cause,
          });
        }
        throw cause;
      }
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

function mapSpotifyDevice(device: SpotifyDevice): AuraDevice {
  if (device.id === null) {
    throw new Error("Spotify returned a device without a usable identifier.");
  }

  return {
    id: device.id,
    name: device.name,
    type: mapDeviceType(device.type),
    isActive: device.isActive,
    available: !device.isRestricted,
    supportsVolume: device.supportsVolume,
  };
}

async function waitForActiveSpotifyDevice(
  api: SpotifyApiClient,
  deviceId: string,
): Promise<{
  target: SpotifyDevice & { id: string };
  devices: SpotifyDevice[];
}> {
  const retryDelays = [0, 180, 360, 720];

  for (const delayMs of retryDelays) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
    }

    const devices = await api.getAvailableDevices();
    const target = devices.find((device) => device.id === deviceId);
    if (target?.isRestricted) {
      throw new Error(`${target.name} does not accept Spotify controls.`);
    }
    if (target?.id && target.isActive) {
      return {
        target: target as SpotifyDevice & { id: string },
        devices,
      };
    }
  }

  throw new Error(
    "Spotify did not activate that device. Start Spotify there and try again.",
  );
}

async function requireActiveSpotifyDevice(
  api: SpotifyApiClient,
  deviceId: string,
): Promise<SpotifyDevice & { id: string }> {
  const devices = await api.getAvailableDevices();
  const target = devices.find((device) => device.id === deviceId);
  if (!target?.id || !target.isActive) {
    throw new Error(
      "Playback moved to another Spotify device. Choose the device Aura should control again.",
    );
  }
  if (target.isRestricted) {
    throw new Error(`${target.name} does not accept Spotify controls.`);
  }
  return target as SpotifyDevice & { id: string };
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
  if (phase === "ready") return "Remote controls ready";
  if (phase === "loading-sdk") return "Preparing remote control";
  if (phase === "connecting") return "Binding selected device";
  if (phase === "reconnecting") return "Reconnecting";
  if (phase === "offline") return "Network offline";
  if (phase === "unavailable") return "Choose a device";
  if (phase === "error") return "Needs attention";
  if (phase === "demo") return "Local preview active";
  return "Choose a playback device";
}
