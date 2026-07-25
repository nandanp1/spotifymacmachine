import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  FileMusic,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useRef } from "react";
import type {
  AppSettings,
  ImportedLrcRecord,
} from "../../shared/types";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { IconButton } from "./IconButton";

export type SettingsValues = AppSettings & {
  syncing?: boolean;
  error?: string | null;
};

interface SettingsDrawerProps {
  open: boolean;
  connected: boolean;
  accountLabel?: string;
  settings: SettingsValues;
  importedLyrics: ImportedLrcRecord[];
  currentImportedLyricsId?: string;
  cacheSizeBytes: number | null | undefined;
  experimentalLyricsEnabled: boolean;
  experimentalLyricsStatus?: string;
  onClose: () => void;
  onChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  onExperimentalLyricsChange: (enabled: boolean) => void;
  onReset: () => void;
  onImportLrc: () => void;
  onRemoveLrc: (id: string) => void;
  onClearCache: () => void;
  onSignOut: () => void;
  onConnect: () => void;
}

const modes: Array<{ id: AppSettings["visualMode"]; label: string }> = [
  { id: "aurora", label: "Aurora" },
  { id: "bloom", label: "Bloom" },
  { id: "orbit", label: "Orbit" },
  { id: "glass", label: "Glass" },
  { id: "ink", label: "Ink" },
  { id: "minimal", label: "Minimal" },
];

export function SettingsDrawer({
  open,
  connected,
  accountLabel,
  settings,
  importedLyrics,
  currentImportedLyricsId,
  cacheSizeBytes,
  experimentalLyricsEnabled,
  experimentalLyricsStatus,
  onClose,
  onChange,
  onExperimentalLyricsChange,
  onReset,
  onImportLrc,
  onRemoveLrc,
  onClearCache,
  onSignOut,
  onConnect,
}: SettingsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useDialogFocus<HTMLElement>(open, closeRef);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            className="overlay-scrim"
            aria-label="Close settings"
            type="button"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            ref={drawerRef}
            className="drawer drawer--settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            initial={{ x: "102%" }}
            animate={{ x: 0 }}
            exit={{ x: "102%" }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="drawer__header">
              <div>
                <p className="eyebrow">Preferences</p>
                <h2 id="settings-title">Tune the room</h2>
              </div>
              <IconButton
                ref={closeRef}
                label="Close settings"
                quiet
                onClick={onClose}
              >
                <X size={19} />
              </IconButton>
            </header>

            <div className="settings-scroll">
              <section className="settings-section">
                <div className="settings-section__title">
                  <ShieldCheck size={16} />
                  <h3>Spotify account</h3>
                </div>
                <div className="account-card">
                  <div>
                    <span
                      className={`status-orb ${connected ? "status-orb--online" : ""}`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{connected ? accountLabel ?? "Spotify connected" : "Not connected"}</strong>
                      <small>
                        {connected
                          ? "Access tokens are held in Keychain"
                          : "Local preview is active"}
                      </small>
                    </span>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={connected ? onSignOut : onConnect}
                  >
                    {connected ? "Sign out" : "Connect"}
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__title">
                  <SlidersHorizontal size={16} />
                  <h3>Listening room</h3>
                </div>
                <ToggleSetting
                  label="Fullscreen on launch"
                  checked={settings.fullscreenOnLaunch}
                  onChange={(value) => onChange("fullscreenOnLaunch", value)}
                />
                <ToggleSetting
                  label="Launch at login"
                  checked={settings.launchAtLogin}
                  onChange={(value) => onChange("launchAtLogin", value)}
                />
                <ToggleSetting
                  label="Hide controls automatically"
                  checked={settings.hideControlsAutomatically}
                  onChange={(value) => onChange("hideControlsAutomatically", value)}
                />
                <ToggleSetting
                  label="Show lyrics by default"
                  checked={settings.showLyricsByDefault}
                  onChange={(value) => onChange("showLyricsByDefault", value)}
                />
                <ToggleSetting
                  label="Menu-bar controls"
                  checked={settings.menuBarEnabled}
                  onChange={(value) => onChange("menuBarEnabled", value)}
                />
              </section>

              <section className="settings-section">
                <div className="settings-section__title">
                  <SlidersHorizontal size={16} />
                  <h3>Visual engine</h3>
                </div>
                <div className="mode-grid" aria-label="Visual mode">
                  {modes.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={settings.visualMode === mode.id ? "is-selected" : ""}
                      aria-pressed={settings.visualMode === mode.id}
                      onClick={() => onChange("visualMode", mode.id)}
                    >
                      <span className={`mode-swatch mode-swatch--${mode.id}`} />
                      {mode.label}
                    </button>
                  ))}
                </div>
                <RangeSetting
                  label="Motion"
                  value={settings.motionIntensity}
                  min={0}
                  max={1}
                  step={0.05}
                  display={`${Math.round(settings.motionIntensity * 100)}%`}
                  onChange={(value) => onChange("motionIntensity", value)}
                />
                <RangeSetting
                  label="Background blur"
                  value={settings.backgroundBlur}
                  min={0}
                  max={1}
                  step={0.05}
                  display={`${Math.round(settings.backgroundBlur * 100)}%`}
                  onChange={(value) => onChange("backgroundBlur", value)}
                />
                <RangeSetting
                  label="Artwork scale"
                  value={settings.artworkScale}
                  min={0.9}
                  max={1.08}
                  step={0.01}
                  display={`${Math.round(settings.artworkScale * 100)}%`}
                  onChange={(value) => onChange("artworkScale", value)}
                />
                <RangeSetting
                  label="Text size"
                  value={settings.textScale}
                  min={0.85}
                  max={1.25}
                  step={0.05}
                  display={`${Math.round(settings.textScale * 100)}%`}
                  onChange={(value) => onChange("textScale", value)}
                />
              </section>

              <section className="settings-section">
                <div className="settings-section__title">
                  <FileMusic size={16} />
                  <h3>Lyrics</h3>
                </div>
                <RangeSetting
                  label="Synchronization offset"
                  value={settings.lyricOffsetMs}
                  min={-5000}
                  max={5000}
                  step={100}
                  display={`${settings.lyricOffsetMs > 0 ? "+" : ""}${(
                    settings.lyricOffsetMs / 1000
                  ).toFixed(1)}s`}
                  onChange={(value) => onChange("lyricOffsetMs", value)}
                />
                {importedLyrics.length ? (
                  <div className="imported-files" aria-label="Imported lyrics">
                    {importedLyrics.map((record) => (
                      <div className="imported-file" key={record.id}>
                        <span>
                          <strong>{record.fileName}</strong>
                          <small>
                            {record.id === currentImportedLyricsId
                              ? "Matched to the current track"
                              : record.title && record.artist
                                ? `${record.title} · ${record.artist}`
                                : `Imported ${formatImportedDate(record.importedAt)}`}
                          </small>
                        </span>
                        <IconButton
                          label={`Remove ${record.fileName}`}
                          size="small"
                          quiet
                          onClick={() => onRemoveLrc(record.id)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </div>
                    ))}
                    <button
                      className="secondary-button secondary-button--full"
                      type="button"
                      onClick={onImportLrc}
                    >
                      <FileMusic size={16} />
                      Import another .lrc
                    </button>
                  </div>
                ) : (
                  <button
                    className="secondary-button secondary-button--full"
                    type="button"
                    onClick={onImportLrc}
                  >
                    <FileMusic size={16} />
                    Import synchronized .lrc
                  </button>
                )}
                <ExperimentalLyricsSetting
                  enabled={experimentalLyricsEnabled}
                  status={experimentalLyricsStatus}
                  onChange={onExperimentalLyricsChange}
                />
              </section>

              <section className="settings-section settings-section--danger">
                <div className="settings-section__title">
                  <Trash2 size={16} />
                  <h3>Storage</h3>
                </div>
                <button className="settings-action" type="button" onClick={onClearCache}>
                  <span>
                    <strong>Clear local web cache</strong>
                    <small>
                      {cacheSizeBytes === null
                        ? "Calculating local web cache…"
                        : cacheSizeBytes === undefined
                          ? "Cache size is currently unavailable"
                        : `${formatBytes(cacheSizeBytes)} cached · imported lyrics remain`}
                    </small>
                  </span>
                  <ExternalLink size={15} />
                </button>
              </section>
            </div>

            <footer className="drawer__footer drawer__footer--settings">
              <button className="ghost-action" type="button" onClick={onReset}>
                <RotateCcw size={15} />
                Restore defaults
              </button>
              {settings.error || settings.syncing ? (
                <span role="status" aria-live="polite">
                  {settings.error ?? "Saving settings…"}
                </span>
              ) : (
                <span>Aura Player · macOS 11+</span>
              )}
            </footer>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

interface ExperimentalLyricsSettingProps {
  enabled: boolean;
  status?: string;
  onChange: (enabled: boolean) => void;
}

function ExperimentalLyricsSetting({
  enabled,
  status,
  onChange,
}: ExperimentalLyricsSettingProps) {
  return (
    <div
      className={`experimental-lyrics-card ${
        enabled ? "experimental-lyrics-card--enabled" : ""
      }`}
    >
      <div className="experimental-lyrics-card__folio" aria-hidden="true">
        <span>External source / 01</span>
        <span>{enabled ? "Opted in" : "Off by default"}</span>
      </div>

      <label className="experimental-lyrics-card__toggle">
        <span className="experimental-lyrics-card__identity">
          <strong id="experimental-lrclib-label">Experimental LRCLIB</strong>
          <small>Community lyric lookup</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          aria-labelledby="experimental-lrclib-label"
          aria-describedby="experimental-lrclib-disclosure experimental-lrclib-policy"
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span
          className="experimental-lyrics-card__control"
          aria-hidden="true"
        >
          <span />
        </span>
      </label>

      <p
        className="experimental-lyrics-card__disclosure"
        id="experimental-lrclib-disclosure"
      >
        If no local match exists, opting in allows Aura to send the current
        track&apos;s title, artist, album, and duration off this Mac to LRCLIB.
        Community-supplied lyrics may have unclear licensing or rights.
      </p>

      <ul
        className="experimental-lyrics-card__policy"
        id="experimental-lrclib-policy"
      >
        <li>
          <strong>Local first</strong>
          <span>Saved .lrc files always take priority.</span>
        </li>
        <li>
          <strong>Release status</strong>
          <span>This adapter is not cleared for public release.</span>
        </li>
      </ul>

      {status ? (
        <p className="experimental-lyrics-card__status">
          <strong>Provider note</strong>
          <span>{status}</span>
        </p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}

function formatImportedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "previously";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

interface ToggleSettingProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleSetting({ label, checked, onChange }: ToggleSettingProps) {
  return (
    <label className="toggle-setting">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="toggle-setting__control" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

interface RangeSettingProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function RangeSetting({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: RangeSettingProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="range-setting">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
      />
    </label>
  );
}
