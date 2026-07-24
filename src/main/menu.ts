import {
  app,
  Menu,
  nativeImage,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";

import { APP_NAME, IPC_CHANNELS } from "../shared/constants";
import type {
  MenuCommand,
  MenuNowPlayingState,
} from "../shared/types";

interface MenuBarControllerOptions {
  getMainWindow: () => BrowserWindow | null;
  showMainWindow: () => BrowserWindow;
}

export class MenuBarController {
  private tray: Tray | null = null;
  private nowPlaying: MenuNowPlayingState | null = null;

  constructor(private readonly options: MenuBarControllerOptions) {}

  get isEnabled(): boolean {
    return this.tray !== null;
  }

  setEnabled(enabled: boolean): void {
    if (enabled && this.tray === null) {
      this.tray = new Tray(createTemplateIcon());
      this.tray.setToolTip(APP_NAME);
      this.tray.on("click", () => this.showWindow());
      this.rebuildMenu();
      return;
    }

    if (!enabled && this.tray !== null) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  setNowPlaying(state: MenuNowPlayingState | null): void {
    this.nowPlaying = state;
    this.rebuildMenu();
  }

  destroy(): void {
    this.setEnabled(false);
  }

  private rebuildMenu(): void {
    if (this.tray === null) {
      return;
    }

    const window = this.options.getMainWindow();
    const hasTrack = this.nowPlaying !== null;
    const trackLabel = hasTrack
      ? truncate(
          `${this.nowPlaying?.title ?? ""} — ${this.nowPlaying?.artist ?? ""}`,
          80,
        )
      : "Nothing playing";
    const template: MenuItemConstructorOptions[] = [
      {
        label: trackLabel,
        enabled: false,
      },
      { type: "separator" },
      {
        label: this.nowPlaying?.isPlaying ? "Pause" : "Play",
        enabled: hasTrack,
        click: () => this.sendPlaybackCommand("playPause"),
      },
      {
        label: "Previous",
        enabled: hasTrack,
        click: () => this.sendPlaybackCommand("previous"),
      },
      {
        label: "Next",
        enabled: hasTrack,
        click: () => this.sendPlaybackCommand("next"),
      },
      { type: "separator" },
      {
        label: `Show ${APP_NAME}`,
        click: () => this.showWindow(),
      },
      {
        label: window?.isFullScreen()
          ? "Exit Full Screen"
          : "Enter Full Screen",
        click: () => {
          const target = this.options.getMainWindow() ?? this.showWindow();
          target.setFullScreen(!target.isFullScreen());
          this.rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: `Quit ${APP_NAME}`,
        role: "quit",
        click: () => app.quit(),
      },
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  private sendPlaybackCommand(command: MenuCommand): void {
    const window = this.options.getMainWindow() ?? this.showWindow();
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.menuCommand, command);
    }
  }

  private showWindow(): BrowserWindow {
    const window = this.options.getMainWindow() ?? this.options.showMainWindow();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    return window;
  }
}

function createTemplateIcon() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">',
    '<path fill="black" d="M9 1.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm0 3.1a4.4 4.4 0 0 1 4.15 2.92 7.1 7.1 0 0 0-8.3 0A4.4 4.4 0 0 1 9 4.6Zm-4.36 5.2a5.82 5.82 0 0 1 8.72 0 4.4 4.4 0 0 1-8.72 0Z"/>',
    "</svg>",
  ].join("");
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  icon.setTemplateImage(true);
  return icon;
}

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }
  return `${value.slice(0, maximumLength - 1)}…`;
}
