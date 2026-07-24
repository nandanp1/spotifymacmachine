export const APP_NAME = "Aura Player";
export const SPOTIFY_DEVICE_NAME = "Aura Player — Mac";

export const DEFAULT_SPOTIFY_REDIRECT_URI =
  "http://127.0.0.1:43821/callback";
export const OAUTH_CALLBACK_HOST = "127.0.0.1";
export const OAUTH_CALLBACK_PATH = "/callback";
export const OAUTH_TIMEOUT_MS = 5 * 60 * 1_000;
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
] as const;

export const KEYCHAIN_SERVICE = "com.auraplayer.desktop";
export const KEYCHAIN_TOKEN_ACCOUNT = "spotify-oauth-tokens";

export const WINDOW_BOUNDS = {
  width: 1_280,
  height: 800,
  minWidth: 760,
  minHeight: 560,
} as const;

export const MAX_LRC_FILE_BYTES = 2 * 1024 * 1024;

export const APPROVED_EXTERNAL_HOSTS = new Set([
  "accounts.spotify.com",
  "open.spotify.com",
  "support.spotify.com",
  "www.spotify.com",
]);

export const IPC_CHANNELS = {
  appGetInfo: "aura:app:get-info",
  appOpenExternal: "aura:app:open-external",
  authGetState: "aura:auth:get-state",
  authSignIn: "aura:auth:sign-in",
  authSignOut: "aura:auth:sign-out",
  authGetWebPlaybackToken: "aura:auth:get-web-playback-token",
  authStateChanged: "aura:auth:state-changed",
  settingsGet: "aura:settings:get",
  settingsUpdate: "aura:settings:update",
  windowGetFullscreen: "aura:window:get-fullscreen",
  windowSetFullscreen: "aura:window:set-fullscreen",
  windowToggleFullscreen: "aura:window:toggle-fullscreen",
  windowFullscreenChanged: "aura:window:fullscreen-changed",
  lyricsImportLrc: "aura:lyrics:import-lrc",
  lyricsListImported: "aura:lyrics:list-imported",
  lyricsReadImported: "aura:lyrics:read-imported",
  lyricsMatchImported: "aura:lyrics:match-imported",
  lyricsDeleteImported: "aura:lyrics:delete-imported",
  recoveryGetState: "aura:recovery:get-state",
  recoverySignal: "aura:recovery:signal",
  cacheGetInfo: "aura:cache:get-info",
  cacheClear: "aura:cache:clear",
  menuUpdateNowPlaying: "aura:menu:update-now-playing",
  menuCommand: "aura:menu:command",
} as const;

export const DEFAULT_SETTINGS = {
  deviceName: SPOTIFY_DEVICE_NAME,
  fullscreenOnLaunch: false,
  launchAtLogin: false,
  hideControlsAutomatically: true,
  showLyricsByDefault: true,
  lyricOffsetMs: 0,
  motionIntensity: 0.72,
  backgroundBlur: 0.72,
  artworkScale: 1,
  menuBarEnabled: false,
  textScale: 1,
  visualMode: "aurora",
} as const;
