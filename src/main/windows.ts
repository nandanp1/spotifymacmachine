import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  shell,
  type Session,
  type WebContents,
} from "electron";

import {
  APPROVED_EXTERNAL_HOSTS,
  APP_NAME,
  IPC_CHANNELS,
  WINDOW_BOUNDS,
} from "../shared/constants";
import { buildContentSecurityPolicy } from "../shared/content-security-policy";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const configuredDevServerUrl =
  process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL;
const securedSessions = new WeakSet<Session>();

interface CreateMainWindowOptions {
  fullscreenOnLaunch: boolean;
}

export function isApprovedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      APPROVED_EXTERNAL_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function createMainWindow({
  fullscreenOnLaunch,
}: CreateMainWindowOptions): BrowserWindow {
  const rendererTarget = resolveRendererTarget();
  const preloadPath = path.join(moduleDirectory, "../preload/preload.js");

  const window = new BrowserWindow({
    title: APP_NAME,
    width: WINDOW_BOUNDS.width,
    height: WINDOW_BOUNDS.height,
    minWidth: WINDOW_BOUNDS.minWidth,
    minHeight: WINDOW_BOUNDS.minHeight,
    show: false,
    fullscreen: fullscreenOnLaunch,
    backgroundColor: "#09090b",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });

  secureSession(window.webContents.session, rendererTarget.isDevelopment);
  secureWebContents(window.webContents, rendererTarget.location);

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  window.on("enter-full-screen", () => {
    sendFullscreenState(window, true);
  });
  window.on("leave-full-screen", () => {
    sendFullscreenState(window, false);
  });

  const load =
    rendererTarget.kind === "url"
      ? window.loadURL(rendererTarget.location)
      : window.loadFile(rendererTarget.location);

  void load.catch(() => {
    // Keep startup failures generic: renderer URLs and environment details do
    // not need to be copied into logs or error surfaces.
    if (!window.isDestroyed()) {
      window.destroy();
    }
  });

  return window;
}

function secureWebContents(
  webContents: WebContents,
  trustedLocation: string,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isApprovedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererNavigation(url, trustedLocation)) {
      return;
    }

    event.preventDefault();
    if (isApprovedExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererNavigation(url, trustedLocation)) {
      event.preventDefault();
    }
  });

  webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

function secureSession(session: Session, isDevelopment: boolean): void {
  if (securedSessions.has(session)) {
    return;
  }
  securedSessions.add(session);

  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    // No renderer permission is currently required. If packaged Spotify DRM
    // verification identifies a narrowly scoped permission, add it explicitly
    // here rather than weakening the default.
    callback(false);
  });

  const contentSecurityPolicy = buildContentSecurityPolicy(isDevelopment);
  session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame") {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy],
      },
    });
  });
}

function resolveRendererTarget():
  | {
      kind: "url";
      location: string;
      isDevelopment: true;
    }
  | {
      kind: "file";
      location: string;
      isDevelopment: false;
    } {
  if (configuredDevServerUrl !== undefined) {
    const url = new URL(configuredDevServerUrl);
    const isLoopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost";

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !isLoopback ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new Error(
        "The Electron renderer development server must be a loopback URL.",
      );
    }

    return {
      kind: "url",
      location: url.toString(),
      isDevelopment: true,
    };
  }

  return {
    kind: "file",
    location: path.join(moduleDirectory, "../renderer/index.html"),
    isDevelopment: false,
  };
}

function isTrustedRendererNavigation(
  candidate: string,
  trustedLocation: string,
): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const trustedUrl =
      trustedLocation.startsWith("file:") ||
      trustedLocation.startsWith("http:") ||
      trustedLocation.startsWith("https:")
        ? new URL(trustedLocation)
        : pathToFileURL(trustedLocation);

    if (trustedUrl.protocol === "file:") {
      return (
        candidateUrl.protocol === "file:" &&
        candidateUrl.pathname === trustedUrl.pathname
      );
    }

    return candidateUrl.origin === trustedUrl.origin;
  } catch {
    return false;
  }
}

function sendFullscreenState(
  window: BrowserWindow,
  fullscreen: boolean,
): void {
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.windowFullscreenChanged, fullscreen);
  }
}
