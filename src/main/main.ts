import path from "node:path";

import { app, dialog, type BrowserWindow } from "electron";

import { APP_NAME } from "../shared/constants";
import { SpotifyAuthService } from "./auth";
import { registerIpcHandlers } from "./ipc";
import { MenuBarController } from "./menu";
import { RecoveryMonitor } from "./recovery-monitor";
import { SecureTokenStore, SettingsStore } from "./secure-store";
import { createMainWindow } from "./windows";

let mainWindow: BrowserWindow | null = null;
let menuBar: MenuBarController | null = null;
let recoveryMonitor: RecoveryMonitor | null = null;
let disposeIpc: (() => void) | null = null;
let initialFullscreen = false;
let hasCreatedInitialWindow = false;

app.name = APP_NAME;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) {
      showMainWindow();
    }
  });

  void app
    .whenReady()
    .then(bootstrap)
    .catch(() => {
      dialog.showErrorBox(
        `${APP_NAME} could not start`,
        "Aura Player could not initialize its secure desktop services.",
      );
      app.quit();
    });
}

async function bootstrap(): Promise<void> {
  const settings = new SettingsStore(
    path.join(app.getPath("userData"), "settings.json"),
  );
  const initialSettings = await settings.get();
  initialFullscreen = initialSettings.fullscreenOnLaunch;

  if (app.isPackaged && initialSettings.launchAtLogin) {
    app.setLoginItemSettings({
      openAtLogin: true,
    });
  }

  const auth = new SpotifyAuthService(createTokenStore());
  menuBar = new MenuBarController({
    getMainWindow: () => mainWindow,
    showMainWindow,
  });
  recoveryMonitor = new RecoveryMonitor();

  disposeIpc = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    auth,
    settings,
    menuBar,
    recovery: recoveryMonitor,
  });
  recoveryMonitor.start();

  showMainWindow();
  menuBar.setEnabled(initialSettings.menuBarEnabled);

  app.on("activate", () => {
    showMainWindow();
  });
}

function showMainWindow(): BrowserWindow {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow({
      fullscreenOnLaunch:
        !hasCreatedInitialWindow && initialFullscreen,
    });
    hasCreatedInitialWindow = true;
    mainWindow.once("closed", () => {
      mainWindow = null;
    });
  } else {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }

  return mainWindow;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  disposeIpc?.();
  disposeIpc = null;
  menuBar?.destroy();
  menuBar = null;
  recoveryMonitor?.destroy();
  recoveryMonitor = null;
});

function createTokenStore(): SecureTokenStore {
  const useEphemeralStore =
    !app.isPackaged &&
    process.env.NODE_ENV === "test" &&
    process.env.AURA_E2E === "1";
  if (!useEphemeralStore) {
    return new SecureTokenStore();
  }

  let value: string | null = null;
  return new SecureTokenStore(
    {
      getPassword: async () => value,
      setPassword: async (_service, _account, nextValue) => {
        value = nextValue;
      },
      deletePassword: async () => {
        value = null;
        return true;
      },
    },
    `${APP_NAME}.e2e`,
    "ephemeral-session",
  );
}
