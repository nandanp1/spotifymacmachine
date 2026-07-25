import {
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";

import {
  APP_NAME,
  IPC_CHANNELS,
  MAX_LRC_FILE_BYTES,
} from "../shared/constants";
import {
  cacheClearResultSchema,
  cacheInfoSchema,
  emptyIpcPayloadSchema,
  externalUrlRequestSchema,
  fullscreenRequestSchema,
  importedLrcDeleteResultSchema,
  importedLrcFileSchema,
  importedLrcIdRequestSchema,
  importedLrcRecordsSchema,
  lrclibCancelRequestSchema,
  lrclibLookupCancelResultSchema,
  lrclibLookupRequestSchema,
  lrclibLyricsLookupResultSchema,
  lyricsImportRequestSchema,
  lyricsMatchRequestSchema,
  menuNowPlayingStateSchema,
  recoverySignalSchema,
  recoveryStateSchema,
  settingsPatchSchema,
} from "../shared/schemas";
import type {
  AppInfo,
  AppSettings,
  CacheClearResult,
  CacheInfo,
  ImportedLrcDeleteResult,
  ImportedLrcFile,
  ImportedLrcRecord,
  LrclibLookupCancelResult,
  LrclibLyricsLookupResult,
  LyricsTrackIdentity,
  MenuNowPlayingState,
} from "../shared/types";
import type { SpotifyAuthService } from "./auth";
import { ImportedLyricsStore } from "./lyrics-store";
import {
  type LrclibLyricsOutcome,
  LrclibLyricsService,
} from "./lrclib-lyrics-service";
import type { MenuBarController } from "./menu";
import type { RecoveryMonitor } from "./recovery-monitor";
import type { SettingsStore } from "./secure-store";
import { isApprovedExternalUrl } from "./windows";

const LRCLIB_SENDER_WINDOW_MS = 5 * 60 * 1_000;
const LRCLIB_MAX_LOOKUPS_PER_WINDOW = 30;

interface IpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  auth: SpotifyAuthService;
  settings: SettingsStore;
  menuBar: MenuBarController;
  recovery: RecoveryMonitor;
  lrclib: LrclibLyricsService;
}

type Handler<TPayload, TResult> = (
  payload: TPayload,
  event: IpcMainInvokeEvent,
) => Promise<TResult> | TResult;

export function registerIpcHandlers({
  getMainWindow,
  auth,
  settings,
  menuBar,
  recovery,
  lrclib,
}: IpcDependencies): () => void {
  const registeredChannels: string[] = [];
  const activeLrclibLookups = new Map<
    string,
    { controller: AbortController; senderId: number }
  >();
  const lrclibRequestHistory = new Map<number, number[]>();
  const lyricsStore = new ImportedLyricsStore(
    path.join(app.getPath("userData"), "lyrics"),
  );

  const register = <TPayload, TResult>(
    channel: string,
    schema: z.ZodType<TPayload>,
    handler: Handler<TPayload, TResult>,
  ): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, rawPayload: unknown) => {
      assertTrustedSender(event, getMainWindow());
      const parsed = schema.safeParse(rawPayload);

      if (!parsed.success) {
        throw new Error(`Invalid IPC payload for ${channel}.`);
      }

      return handler(parsed.data, event);
    });
    registeredChannels.push(channel);
  };

  register(
    IPC_CHANNELS.appGetInfo,
    emptyIpcPayloadSchema,
    (): AppInfo => ({
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      playbackRuntime: {
        drmStatus: "unsupported",
        detail:
          "This macOS 11 build controls an explicitly selected Spotify device; it does not play Spotify audio locally.",
      },
    }),
  );

  register(
    IPC_CHANNELS.appOpenExternal,
    externalUrlRequestSchema,
    async ({ url }) => {
      if (!isApprovedExternalUrl(url)) {
        throw new Error("This external URL is not approved.");
      }
      await shell.openExternal(url);
    },
  );

  register(IPC_CHANNELS.authGetState, emptyIpcPayloadSchema, () =>
    auth.getState(),
  );
  register(IPC_CHANNELS.authSignIn, emptyIpcPayloadSchema, () =>
    auth.signIn(),
  );
  register(IPC_CHANNELS.authSignOut, emptyIpcPayloadSchema, () =>
    auth.signOut(),
  );
  register(
    IPC_CHANNELS.authGetWebPlaybackToken,
    emptyIpcPayloadSchema,
    () => auth.getWebPlaybackToken(),
  );

  register(IPC_CHANNELS.settingsGet, emptyIpcPayloadSchema, () =>
    settings.get(),
  );
  register(
    IPC_CHANNELS.settingsUpdate,
    settingsPatchSchema,
    async (patch): Promise<AppSettings> => {
      const previous = await settings.get();
      const next = await settings.update(patch);

      if (next.launchAtLogin !== previous.launchAtLogin) {
        if (app.isPackaged) {
          app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
        }
      }
      if (next.menuBarEnabled !== previous.menuBarEnabled) {
        menuBar.setEnabled(next.menuBarEnabled);
      }
      if (
        previous.experimentalLrclibEnabled &&
        !next.experimentalLrclibEnabled
      ) {
        abortActiveLrclibLookups(activeLrclibLookups);
        lrclib.clearCache();
      }

      return next;
    },
  );

  register(
    IPC_CHANNELS.windowGetFullscreen,
    emptyIpcPayloadSchema,
    () => requireMainWindow(getMainWindow()).isFullScreen(),
  );
  register(
    IPC_CHANNELS.windowSetFullscreen,
    fullscreenRequestSchema,
    ({ fullscreen }) => {
      const window = requireMainWindow(getMainWindow());
      window.setFullScreen(fullscreen);
      return fullscreen;
    },
  );
  register(
    IPC_CHANNELS.windowToggleFullscreen,
    emptyIpcPayloadSchema,
    () => {
      const window = requireMainWindow(getMainWindow());
      const fullscreen = !window.isFullScreen();
      window.setFullScreen(fullscreen);
      return fullscreen;
    },
  );

  register(
    IPC_CHANNELS.lyricsImportLrc,
    lyricsImportRequestSchema,
    async ({ track }): Promise<ImportedLrcFile | null> => {
      const result = await importLrcFile(
        requireMainWindow(getMainWindow()),
        lyricsStore,
        track,
      );
      return importedLrcFileSchema.nullable().parse(result);
    },
  );
  register(
    IPC_CHANNELS.lyricsListImported,
    emptyIpcPayloadSchema,
    async (): Promise<ImportedLrcRecord[]> =>
      importedLrcRecordsSchema.parse(await lyricsStore.list()),
  );
  register(
    IPC_CHANNELS.lyricsReadImported,
    importedLrcIdRequestSchema,
    async ({ id }): Promise<ImportedLrcFile | null> =>
      importedLrcFileSchema.nullable().parse(await lyricsStore.read(id)),
  );
  register(
    IPC_CHANNELS.lyricsMatchImported,
    lyricsMatchRequestSchema,
    async ({ track }): Promise<ImportedLrcFile | null> =>
      importedLrcFileSchema
        .nullable()
        .parse(await lyricsStore.match(track)),
  );
  register(
    IPC_CHANNELS.lyricsDeleteImported,
    importedLrcIdRequestSchema,
    async ({ id }): Promise<ImportedLrcDeleteResult> =>
      importedLrcDeleteResultSchema.parse(
        await lyricsStore.delete(id),
      ),
  );
  register(
    IPC_CHANNELS.lyricsLookupLrclib,
    lrclibLookupRequestSchema,
    async (
      { requestId, track },
      event,
    ): Promise<LrclibLyricsLookupResult> => {
      if (activeLrclibLookups.has(requestId)) {
        throw new Error("This lyrics lookup request is already active.");
      }
      if (
        [...activeLrclibLookups.values()].some(
          ({ senderId }) => senderId === event.sender.id,
        )
      ) {
        throw new Error("A lyrics lookup is already active for this window.");
      }

      const controller = new AbortController();
      const activeLookup = {
        controller,
        senderId: event.sender.id,
      };
      const abortWhenSenderCloses = () => {
        lrclibRequestHistory.delete(event.sender.id);
        if (activeLrclibLookups.get(requestId) === activeLookup) {
          activeLrclibLookups.delete(requestId);
        }
        controller.abort(
          new DOMException("The lyrics window was closed.", "AbortError"),
        );
      };
      activeLrclibLookups.set(requestId, activeLookup);
      event.sender.once("destroyed", abortWhenSenderCloses);

      try {
        const currentSettings = await settings.get();
        if (!currentSettings.experimentalLrclibEnabled) {
          return lrclibLyricsLookupResultSchema.parse({
            status: "disabled",
            provider: "lrclib",
          });
        }
        controller.signal.throwIfAborted();
        const localRetryAfterMs = consumeLrclibRequestBudget(
          lrclibRequestHistory,
          event.sender.id,
          Date.now(),
        );
        if (localRetryAfterMs > 0) {
          return lrclibLyricsLookupResultSchema.parse({
            status: "rate-limited",
            provider: "lrclib",
            retryAfterMs: localRetryAfterMs,
          });
        }
        const outcome = await lrclib.lookup(track, controller.signal);
        return lrclibLyricsLookupResultSchema.parse(
          mapLrclibOutcome(outcome),
        );
      } finally {
        event.sender.removeListener("destroyed", abortWhenSenderCloses);
        if (activeLrclibLookups.get(requestId) === activeLookup) {
          activeLrclibLookups.delete(requestId);
        }
      }
    },
  );
  register(
    IPC_CHANNELS.lyricsCancelLrclib,
    lrclibCancelRequestSchema,
    ({ requestId }, event): LrclibLookupCancelResult => {
      const activeLookup = activeLrclibLookups.get(requestId);
      const cancelled =
        activeLookup !== undefined &&
        activeLookup.senderId === event.sender.id;

      if (cancelled) {
        activeLrclibLookups.delete(requestId);
        activeLookup.controller.abort(
          new DOMException("The lyrics lookup was cancelled.", "AbortError"),
        );
      }

      return lrclibLookupCancelResultSchema.parse({ cancelled });
    },
  );

  register(
    IPC_CHANNELS.recoveryGetState,
    emptyIpcPayloadSchema,
    () => recoveryStateSchema.parse(recovery.getState()),
  );

  register(
    IPC_CHANNELS.cacheGetInfo,
    emptyIpcPayloadSchema,
    async (): Promise<CacheInfo> => {
      const sizeBytes = await requireMainWindow(
        getMainWindow(),
      ).webContents.session.getCacheSize();
      return cacheInfoSchema.parse({ sizeBytes });
    },
  );

  register(
    IPC_CHANNELS.cacheClear,
    emptyIpcPayloadSchema,
    async (): Promise<CacheClearResult> => {
      await requireMainWindow(getMainWindow()).webContents.session.clearCache();
      lrclib.clearCache();
      return cacheClearResultSchema.parse({ cleared: true });
    },
  );

  register(
    IPC_CHANNELS.menuUpdateNowPlaying,
    menuNowPlayingStateSchema,
    (state: MenuNowPlayingState | null) => {
      menuBar.setNowPlaying(state);
    },
  );

  const unsubscribeAuth = auth.subscribe((state) => {
    if (state.status !== "authenticated") {
      abortActiveLrclibLookups(activeLrclibLookups);
      lrclibRequestHistory.clear();
      lrclib.clearCache();
    }
    const window = getMainWindow();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.authStateChanged, state);
    }
  });
  const unsubscribeRecovery = recovery.subscribe((rawSignal) => {
    const signal = recoverySignalSchema.parse(rawSignal);
    const window = getMainWindow();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.recoverySignal, signal);
    }
  });

  return () => {
    unsubscribeAuth();
    unsubscribeRecovery();
    abortActiveLrclibLookups(activeLrclibLookups);
    lrclibRequestHistory.clear();
    lrclib.clearCache();
    for (const channel of registeredChannels) {
      ipcMain.removeHandler(channel);
    }
  };
}

function consumeLrclibRequestBudget(
  histories: Map<number, number[]>,
  senderId: number,
  now: number,
): number {
  const cutoff = now - LRCLIB_SENDER_WINDOW_MS;
  const recent = (histories.get(senderId) ?? []).filter(
    (timestamp) => timestamp > cutoff,
  );
  if (recent.length >= LRCLIB_MAX_LOOKUPS_PER_WINDOW) {
    histories.set(senderId, recent);
    return Math.max(
      1,
      (recent[0] ?? now) + LRCLIB_SENDER_WINDOW_MS - now,
    );
  }

  recent.push(now);
  histories.set(senderId, recent);
  return 0;
}

function mapLrclibOutcome(
  outcome: LrclibLyricsOutcome,
): LrclibLyricsLookupResult {
  switch (outcome.status) {
    case "found":
      return {
        status: "found",
        provider: "lrclib",
        format: "lrc",
        content: outcome.syncedLyrics,
      };
    case "instrumental":
      return { status: "instrumental", provider: "lrclib" };
    case "not-found":
      return { status: "not-found", provider: "lrclib" };
    case "rate-limited":
      return {
        status: "rate-limited",
        provider: "lrclib",
        retryAfterMs: outcome.retryAfterMs,
      };
    case "network-error":
      return {
        status: "error",
        provider: "lrclib",
        code: outcome.reason === "timeout" ? "timeout" : "network",
      };
    case "invalid-track":
    case "malformed-response":
      return {
        status: "error",
        provider: "lrclib",
        code: "invalid-response",
      };
  }
}

function abortActiveLrclibLookups(
  lookups: Map<
    string,
    { controller: AbortController; senderId: number }
  >,
): void {
  for (const { controller } of lookups.values()) {
    controller.abort(
      new DOMException("Remote lyrics were disabled.", "AbortError"),
    );
  }
  lookups.clear();
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
): void {
  if (
    mainWindow === null ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("IPC request rejected.");
  }
}

function requireMainWindow(
  window: BrowserWindow | null,
): BrowserWindow {
  if (window === null || window.isDestroyed()) {
    throw new Error("The Aura Player window is not available.");
  }
  return window;
}

async function importLrcFile(
  window: BrowserWindow,
  lyricsStore: ImportedLyricsStore,
  track?: LyricsTrackIdentity,
): Promise<ImportedLrcFile | null> {
  const selection = await dialog.showOpenDialog(window, {
    title: "Import synchronized lyrics",
    buttonLabel: "Import Lyrics",
    properties: ["openFile"],
    filters: [{ name: "LRC lyrics", extensions: ["lrc"] }],
  });

  const selectedPath = selection.filePaths[0];
  if (selection.canceled || selectedPath === undefined) {
    return null;
  }

  let sourcePath: string;
  try {
    sourcePath = await realpath(selectedPath);
  } catch {
    throw new Error("The selected lyrics file could not be read.");
  }

  if (path.extname(sourcePath).toLowerCase() !== ".lrc") {
    throw new Error("Choose a file with the .lrc extension.");
  }

  let fileStat;
  try {
    fileStat = await stat(sourcePath);
  } catch {
    throw new Error("The selected lyrics file could not be inspected.");
  }
  if (!fileStat.isFile()) {
    throw new Error("The selected lyrics item is not a file.");
  }
  if (fileStat.size > MAX_LRC_FILE_BYTES) {
    throw new Error("The selected lyrics file is too large.");
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(sourcePath);
  } catch {
    throw new Error("The selected lyrics file could not be read.");
  }
  if (bytes.byteLength > MAX_LRC_FILE_BYTES) {
    throw new Error("The selected lyrics file is too large.");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The selected lyrics file must use UTF-8 text.");
  }

  content = content.replace(/^\uFEFF/, "");
  if (content.includes("\u0000")) {
    throw new Error("The selected lyrics file contains invalid text.");
  }

  return lyricsStore.save({
    fileName: sanitizeFileName(path.basename(sourcePath)),
    content,
    track,
  });
}

function sanitizeFileName(value: string): string {
  const withoutControls = [...value.normalize("NFC")]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint > 31 &&
        codePoint !== 127 &&
        character !== "/" &&
        character !== "\\" &&
        character !== ":"
      );
    })
    .join("")
    .trim();
  const safeName = withoutControls.length > 0 ? withoutControls : "lyrics.lrc";

  if (safeName.length <= 180) {
    return safeName;
  }

  return `${safeName.slice(0, 176)}.lrc`;
}
