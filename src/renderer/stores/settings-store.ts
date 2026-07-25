"use client";

import { useEffect, useSyncExternalStore } from "react";

import { DEFAULT_SETTINGS } from "../../shared/constants";
import type { AppSettings } from "../../shared/types";

export interface SettingsStoreSnapshot extends AppSettings {
  hydrated: boolean;
  syncing: boolean;
  error: string | null;
  updateSetting<Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ): Promise<void>;
  resetSettings(): Promise<void>;
}

const FALLBACK_STORAGE_KEY = "aura-player:settings:v1";
type SettingsListener = () => void;

class AuraSettingsStore {
  private listeners = new Set<SettingsListener>();
  private snapshot: SettingsStoreSnapshot;
  private updateGeneration = 0;

  constructor() {
    this.snapshot = this.makeSnapshot(DEFAULT_SETTINGS, {
      hydrated: false,
      syncing: false,
      error: null,
    });
  }

  getSnapshot = (): SettingsStoreSnapshot => this.snapshot;

  subscribe = (listener: SettingsListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  hydrate = async (): Promise<void> => {
    if (this.snapshot.hydrated) {
      return;
    }

    let settings: AppSettings;
    try {
      settings = hasDesktopSettingsApi()
        ? await window.aura.settings.get()
        : readFallbackSettings();
      settings = validateSettings(settings, DEFAULT_SETTINGS);
      this.snapshot = this.makeSnapshot(settings, {
        hydrated: true,
        syncing: false,
        error: null,
      });
    } catch {
      this.snapshot = this.makeSnapshot(DEFAULT_SETTINGS, {
        hydrated: true,
        syncing: false,
        error: "Settings could not be loaded; Aura is using safe defaults.",
      });
    }
    this.emit();
  };

  updateSetting = async <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ): Promise<void> => {
    const generation = ++this.updateGeneration;
    const previous = settingsFromSnapshot(this.snapshot);
    const optimistic = validateSettings(
      { ...previous, [key]: value },
      previous,
    );

    this.snapshot = this.makeSnapshot(optimistic, {
      hydrated: this.snapshot.hydrated,
      syncing: true,
      error: null,
    });
    this.emit();

    try {
      const confirmed = hasDesktopSettingsApi()
        ? await window.aura.settings.update({ [key]: optimistic[key] })
        : persistFallbackSettings(optimistic);
      if (generation !== this.updateGeneration) {
        return;
      }
      this.snapshot = this.makeSnapshot(
        validateSettings(confirmed, optimistic),
        {
          hydrated: true,
          syncing: false,
          error: null,
        },
      );
      this.emit();
    } catch {
      if (generation !== this.updateGeneration) {
        return;
      }
      this.snapshot = this.makeSnapshot(previous, {
        hydrated: true,
        syncing: false,
        error: "That setting could not be saved.",
      });
      this.emit();
    }
  };

  resetSettings = async (): Promise<void> => {
    const generation = ++this.updateGeneration;
    const previous = settingsFromSnapshot(this.snapshot);
    this.snapshot = this.makeSnapshot(DEFAULT_SETTINGS, {
      hydrated: this.snapshot.hydrated,
      syncing: true,
      error: null,
    });
    this.emit();

    try {
      const confirmed = hasDesktopSettingsApi()
        ? await window.aura.settings.update({ ...DEFAULT_SETTINGS })
        : persistFallbackSettings(DEFAULT_SETTINGS);
      if (generation !== this.updateGeneration) {
        return;
      }
      this.snapshot = this.makeSnapshot(
        validateSettings(confirmed, DEFAULT_SETTINGS),
        {
          hydrated: true,
          syncing: false,
          error: null,
        },
      );
      this.emit();
    } catch {
      if (generation !== this.updateGeneration) {
        return;
      }
      this.snapshot = this.makeSnapshot(previous, {
        hydrated: true,
        syncing: false,
        error: "Settings could not be reset.",
      });
      this.emit();
    }
  };

  private makeSnapshot(
    settings: Readonly<AppSettings>,
    status: Pick<SettingsStoreSnapshot, "hydrated" | "syncing" | "error">,
  ): SettingsStoreSnapshot {
    return {
      ...settings,
      ...status,
      updateSetting: this.updateSetting,
      resetSettings: this.resetSettings,
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const settingsStore = new AuraSettingsStore();

export function updateSetting<Key extends keyof AppSettings>(
  key: Key,
  value: AppSettings[Key],
): Promise<void> {
  return settingsStore.updateSetting(key, value);
}

export function resetSettings(): Promise<void> {
  return settingsStore.resetSettings();
}

export function useSettingsStore(): SettingsStoreSnapshot;
export function useSettingsStore<Selected>(
  selector: (settings: SettingsStoreSnapshot) => Selected,
): Selected;
export function useSettingsStore<Selected>(
  selector?: (settings: SettingsStoreSnapshot) => Selected,
): SettingsStoreSnapshot | Selected {
  useEffect(() => {
    void settingsStore.hydrate();
  }, []);

  const snapshot = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
  return selector ? selector(snapshot) : snapshot;
}

function hasDesktopSettingsApi(): boolean {
  return (
    typeof window !== "undefined" &&
    "aura" in window &&
    typeof window.aura?.settings?.get === "function"
  );
}

function readFallbackSettings(): AppSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const value = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    const parsed: unknown = value ? JSON.parse(value) : null;
    return validateSettings(parsed, DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistFallbackSettings(
  settings: Readonly<AppSettings>,
): AppSettings {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      FALLBACK_STORAGE_KEY,
      JSON.stringify(settings),
    );
  }
  return { ...settings };
}

function validateSettings(
  value: unknown,
  fallback: Readonly<AppSettings>,
): AppSettings {
  const candidate = isRecord(value) ? value : {};
  const visualMode =
    candidate.visualMode === "aurora" ||
    candidate.visualMode === "bloom" ||
    candidate.visualMode === "orbit" ||
    candidate.visualMode === "glass" ||
    candidate.visualMode === "ink" ||
    candidate.visualMode === "minimal"
      ? candidate.visualMode
      : fallback.visualMode;

  return {
    deviceName: stringOr(candidate.deviceName, fallback.deviceName, 80),
    fullscreenOnLaunch: booleanOr(
      candidate.fullscreenOnLaunch,
      fallback.fullscreenOnLaunch,
    ),
    launchAtLogin: booleanOr(
      candidate.launchAtLogin,
      fallback.launchAtLogin,
    ),
    hideControlsAutomatically: booleanOr(
      candidate.hideControlsAutomatically,
      fallback.hideControlsAutomatically,
    ),
    showLyricsByDefault: booleanOr(
      candidate.showLyricsByDefault,
      fallback.showLyricsByDefault,
    ),
    experimentalLrclibEnabled: booleanOr(
      candidate.experimentalLrclibEnabled,
      fallback.experimentalLrclibEnabled,
    ),
    lyricOffsetMs: Math.round(
      clampNumber(
        candidate.lyricOffsetMs,
        -10_000,
        10_000,
        fallback.lyricOffsetMs,
      ),
    ),
    motionIntensity: clampNumber(
      candidate.motionIntensity,
      0,
      1,
      fallback.motionIntensity,
    ),
    backgroundBlur: clampNumber(
      candidate.backgroundBlur,
      0,
      1,
      fallback.backgroundBlur,
    ),
    artworkScale: clampNumber(
      candidate.artworkScale,
      0.9,
      1.08,
      fallback.artworkScale,
    ),
    menuBarEnabled: booleanOr(
      candidate.menuBarEnabled,
      fallback.menuBarEnabled,
    ),
    textScale: clampNumber(
      candidate.textScale,
      0.85,
      1.25,
      fallback.textScale,
    ),
    visualMode,
  };
}

function settingsFromSnapshot(snapshot: SettingsStoreSnapshot): AppSettings {
  return {
    deviceName: snapshot.deviceName,
    fullscreenOnLaunch: snapshot.fullscreenOnLaunch,
    launchAtLogin: snapshot.launchAtLogin,
    hideControlsAutomatically: snapshot.hideControlsAutomatically,
    showLyricsByDefault: snapshot.showLyricsByDefault,
    experimentalLrclibEnabled: snapshot.experimentalLrclibEnabled,
    lyricOffsetMs: snapshot.lyricOffsetMs,
    motionIntensity: snapshot.motionIntensity,
    backgroundBlur: snapshot.backgroundBlur,
    artworkScale: snapshot.artworkScale,
    menuBarEnabled: snapshot.menuBarEnabled,
    textScale: snapshot.textScale,
    visualMode: snapshot.visualMode,
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : fallback;
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
