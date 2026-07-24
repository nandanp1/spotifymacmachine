import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from "electron";

import { IPC_CHANNELS } from "../shared/constants";
import {
  importedLrcDeleteResultSchema,
  importedLrcFileSchema,
  importedLrcIdRequestSchema,
  importedLrcRecordsSchema,
  lyricsImportRequestSchema,
  lyricsMatchRequestSchema,
} from "../shared/schemas";
import type {
  AppInfo,
  AppSettings,
  AuraDesktopApi,
  AuthState,
  CacheClearResult,
  CacheInfo,
  ImportedLrcDeleteResult,
  ImportedLrcFile,
  ImportedLrcRecord,
  LyricsTrackIdentity,
  MenuCommand,
  MenuNowPlayingState,
  RecoverySignal,
  RecoveryState,
  WebPlaybackToken,
} from "../shared/types";

function subscribeToValidatedEvent<T>(
  channel: string,
  validator: (value: unknown) => value is T,
  listener: (value: T) => void,
): () => void {
  const wrapped = (_event: IpcRendererEvent, value: unknown) => {
    if (validator(value)) {
      listener(value);
    }
  };

  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: AuraDesktopApi = Object.freeze({
  platform: process.platform,
  app: Object.freeze({
    getInfo: () =>
      ipcRenderer.invoke(IPC_CHANNELS.appGetInfo) as Promise<AppInfo>,
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, { url }) as Promise<void>,
  }),
  auth: Object.freeze({
    getState: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authGetState) as Promise<AuthState>,
    signIn: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authSignIn) as Promise<AuthState>,
    signOut: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authSignOut) as Promise<AuthState>,
    getWebPlaybackToken: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.authGetWebPlaybackToken,
      ) as Promise<WebPlaybackToken>,
    onStateChanged: (listener: (state: AuthState) => void) =>
      subscribeToValidatedEvent(
        IPC_CHANNELS.authStateChanged,
        isAuthState,
        listener,
      ),
  }),
  settings: Object.freeze({
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.settingsUpdate,
        patch,
      ) as Promise<AppSettings>,
  }),
  window: Object.freeze({
    getFullscreen: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.windowGetFullscreen,
      ) as Promise<boolean>,
    setFullscreen: (fullscreen: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.windowSetFullscreen, {
        fullscreen,
      }) as Promise<boolean>,
    toggleFullscreen: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.windowToggleFullscreen,
      ) as Promise<boolean>,
    onFullscreenChanged: (listener: (fullscreen: boolean) => void) =>
      subscribeToValidatedEvent(
        IPC_CHANNELS.windowFullscreenChanged,
        isBoolean,
        listener,
      ),
  }),
  lyrics: Object.freeze({
    importLrc: async (
      track?: LyricsTrackIdentity,
    ): Promise<ImportedLrcFile | null> => {
      const payload = lyricsImportRequestSchema.parse({ track });
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.lyricsImportLrc,
        payload,
      );
      return importedLrcFileSchema.nullable().parse(value);
    },
    listImported: async (): Promise<ImportedLrcRecord[]> => {
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.lyricsListImported,
      );
      return importedLrcRecordsSchema.parse(value);
    },
    readImported: async (
      id: string,
    ): Promise<ImportedLrcFile | null> => {
      const payload = importedLrcIdRequestSchema.parse({ id });
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.lyricsReadImported,
        payload,
      );
      return importedLrcFileSchema.nullable().parse(value);
    },
    matchImported: async (
      track: LyricsTrackIdentity,
    ): Promise<ImportedLrcFile | null> => {
      const payload = lyricsMatchRequestSchema.parse({ track });
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.lyricsMatchImported,
        payload,
      );
      return importedLrcFileSchema.nullable().parse(value);
    },
    deleteImported: async (
      id: string,
    ): Promise<ImportedLrcDeleteResult> => {
      const payload = importedLrcIdRequestSchema.parse({ id });
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.lyricsDeleteImported,
        payload,
      );
      return importedLrcDeleteResultSchema.parse(value);
    },
  }),
  recovery: Object.freeze({
    getState: async () => {
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryGetState,
      );
      if (!isRecoveryState(value)) {
        throw new Error("Aura Player received an invalid recovery state.");
      }
      return value;
    },
    onSignal: (listener: (signal: RecoverySignal) => void) =>
      subscribeToValidatedEvent(
        IPC_CHANNELS.recoverySignal,
        isRecoverySignal,
        listener,
      ),
  }),
  cache: Object.freeze({
    getInfo: async (): Promise<CacheInfo> => {
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.cacheGetInfo,
      );
      if (!isCacheInfo(value)) {
        throw new Error("Aura Player received invalid cache information.");
      }
      return value;
    },
    clear: async (): Promise<CacheClearResult> => {
      const value: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.cacheClear,
      );
      if (!isCacheClearResult(value)) {
        throw new Error("Aura Player received an invalid cache result.");
      }
      return value;
    },
  }),
  menu: Object.freeze({
    updateNowPlaying: (state: MenuNowPlayingState | null) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.menuUpdateNowPlaying,
        state,
      ) as Promise<void>,
    onCommand: (listener: (command: MenuCommand) => void) =>
      subscribeToValidatedEvent(
        IPC_CHANNELS.menuCommand,
        isMenuCommand,
        listener,
      ),
  }),
});

contextBridge.exposeInMainWorld("aura", api);

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isMenuCommand(value: unknown): value is MenuCommand {
  return (
    value === "playPause" || value === "previous" || value === "next"
  );
}

function isAuthState(value: unknown): value is AuthState {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }

  if (value.status === "signedOut") {
    return true;
  }

  if (value.status === "authenticated") {
    return (
      typeof value.expiresAt === "number" &&
      Array.isArray(value.scopes) &&
      value.scopes.every((scope) => typeof scope === "string")
    );
  }

  return (
    value.status === "expired" &&
    (value.reason === "configuration" ||
      value.reason === "keychain" ||
      value.reason === "network" ||
      value.reason === "refreshRejected" ||
      value.reason === "unknown")
  );
}

function isCacheInfo(value: unknown): value is CacheInfo {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.sizeBytes === "number" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes >= 0
  );
}

function isCacheClearResult(value: unknown): value is CacheClearResult {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    value.cleared === true
  );
}

function isRecoveryState(value: unknown): value is RecoveryState {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    typeof value.suspended === "boolean" &&
    typeof value.screenLocked === "boolean" &&
    typeof value.online === "boolean" &&
    typeof value.observedAt === "number" &&
    Number.isSafeInteger(value.observedAt) &&
    value.observedAt > 0
  );
}

function isRecoverySignal(value: unknown): value is RecoverySignal {
  if (
    !isRecord(value) ||
    !isRecoveryState(value.state) ||
    typeof value.kind !== "string"
  ) {
    return false;
  }

  if (value.kind === "network") {
    return (
      Object.keys(value).length === 3 &&
      typeof value.online === "boolean" &&
      value.online === value.state.online
    );
  }

  return (
    value.kind === "power" &&
    Object.keys(value).length === 3 &&
    ((value.event === "suspend" && value.state.suspended) ||
      (value.event === "resume" && !value.state.suspended) ||
      (value.event === "lock-screen" && value.state.screenLocked) ||
      (value.event === "unlock-screen" && !value.state.screenLocked))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
