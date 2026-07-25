export type VisualMode =
  | "aurora"
  | "bloom"
  | "orbit"
  | "glass"
  | "ink"
  | "minimal";

export interface AppSettings {
  deviceName: string;
  fullscreenOnLaunch: boolean;
  launchAtLogin: boolean;
  hideControlsAutomatically: boolean;
  showLyricsByDefault: boolean;
  experimentalLrclibEnabled: boolean;
  lyricOffsetMs: number;
  motionIntensity: number;
  backgroundBlur: number;
  artworkScale: number;
  menuBarEnabled: boolean;
  textScale: number;
  visualMode: VisualMode;
}

export interface SpotifyTokenRecord {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scopes: string[];
  expiresAt: number;
}

export type AuthState =
  | { status: "signedOut" }
  | {
      status: "authenticated";
      expiresAt: number;
      scopes: string[];
    }
  | {
      status: "expired";
      reason:
        | "configuration"
        | "keychain"
        | "network"
        | "refreshRejected"
        | "unknown";
    };

/** The renderer may use this short-lived token in memory for Spotify Web API calls. */
export interface WebPlaybackToken {
  accessToken: string;
  expiresAt: number;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  playbackRuntime: {
    drmStatus: "unsupported";
    detail: string;
  };
}

export interface LyricsTrackIdentity {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  isrc?: string;
}

export interface LrclibTrackIdentity extends LyricsTrackIdentity {
  album: string;
}

export interface ImportedLrcRecord {
  id: string;
  fileName: string;
  sizeBytes: number;
  importedAt: string;
  spotifyTrackId?: string;
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
}

export interface ImportedLrcFile extends ImportedLrcRecord {
  content: string;
}

export interface ImportedLrcDeleteResult {
  deleted: boolean;
}

export type LrclibLyricsLookupResult =
  | {
      status: "found";
      provider: "lrclib";
      format: "lrc" | "plain";
      content: string;
    }
  | {
      status: "not-found" | "instrumental" | "disabled";
      provider: "lrclib";
    }
  | {
      status: "rate-limited";
      provider: "lrclib";
      retryAfterMs: number;
    }
  | {
      status: "error";
      provider: "lrclib";
      code: "network" | "timeout" | "invalid-response";
    };

export interface LrclibLookupCancelResult {
  cancelled: boolean;
}

export interface CacheClearResult {
  cleared: true;
}

export interface CacheInfo {
  sizeBytes: number;
}

export interface RecoveryState {
  suspended: boolean;
  screenLocked: boolean;
  online: boolean;
  observedAt: number;
}

export type RecoverySignal =
  | {
      kind: "power";
      event: "suspend" | "resume" | "lock-screen" | "unlock-screen";
      state: RecoveryState;
    }
  | {
      kind: "network";
      online: boolean;
      state: RecoveryState;
    };

export type MenuCommand = "playPause" | "previous" | "next";

export interface MenuNowPlayingState {
  title: string;
  artist: string;
  isPlaying: boolean;
}

export type Unsubscribe = () => void;

export interface AuraDesktopApi {
  readonly platform: string;
  readonly app: {
    getInfo(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
  };
  readonly auth: {
    getState(): Promise<AuthState>;
    signIn(): Promise<AuthState>;
    signOut(): Promise<AuthState>;
    getWebPlaybackToken(): Promise<WebPlaybackToken>;
    onStateChanged(listener: (state: AuthState) => void): Unsubscribe;
  };
  readonly settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  readonly window: {
    getFullscreen(): Promise<boolean>;
    setFullscreen(fullscreen: boolean): Promise<boolean>;
    toggleFullscreen(): Promise<boolean>;
    onFullscreenChanged(listener: (fullscreen: boolean) => void): Unsubscribe;
  };
  readonly lyrics: {
    importLrc(track?: LyricsTrackIdentity): Promise<ImportedLrcFile | null>;
    listImported(): Promise<ImportedLrcRecord[]>;
    readImported(id: string): Promise<ImportedLrcFile | null>;
    matchImported(
      track: LyricsTrackIdentity,
    ): Promise<ImportedLrcFile | null>;
    deleteImported(id: string): Promise<ImportedLrcDeleteResult>;
    lookupLrclib(
      requestId: string,
      track: LrclibTrackIdentity,
    ): Promise<LrclibLyricsLookupResult>;
    cancelLrclib(requestId: string): Promise<LrclibLookupCancelResult>;
  };
  readonly recovery: {
    getState(): Promise<RecoveryState>;
    onSignal(listener: (signal: RecoverySignal) => void): Unsubscribe;
  };
  readonly cache: {
    getInfo(): Promise<CacheInfo>;
    clear(): Promise<CacheClearResult>;
  };
  readonly menu: {
    updateNowPlaying(state: MenuNowPlayingState | null): Promise<void>;
    onCommand(listener: (command: MenuCommand) => void): Unsubscribe;
  };
}
