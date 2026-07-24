import {
  Library,
  ListMusic,
  Pause,
  Play,
  Settings2,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import type { PlaybackRestrictions } from "../features/player/playback-service";
import { formatDuration } from "../lib/format";
import { IconButton } from "./IconButton";

interface TransportProps {
  visible: boolean;
  playbackEnabled?: boolean;
  volumeEnabled?: boolean;
  playing: boolean;
  restrictions?: PlaybackRestrictions;
  positionMs: number;
  durationMs: number;
  volume: number;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (positionMs: number) => void;
  onVolume: (volume: number) => void;
  onOpenLibrary: () => void;
  onOpenDevices: () => void;
  onOpenSettings: () => void;
}

export function Transport({
  visible,
  playbackEnabled = true,
  volumeEnabled = playbackEnabled,
  playing,
  restrictions,
  positionMs,
  durationMs,
  volume,
  onPlayPause,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onOpenLibrary,
  onOpenDevices,
  onOpenSettings,
}: TransportProps) {
  const safeDuration = Math.max(durationMs, 1);
  const playPauseEnabled =
    playbackEnabled &&
    (playing
      ? restrictions?.pausing !== true
      : restrictions?.resuming !== true);
  const previousEnabled =
    playbackEnabled && restrictions?.skippingPrevious !== true;
  const nextEnabled =
    playbackEnabled && restrictions?.skippingNext !== true;
  const seekEnabled =
    playbackEnabled && restrictions?.seeking !== true;
  const seek = useCommittedRange({
    value: positionMs,
    min: 0,
    max: safeDuration,
    enabled: seekEnabled,
    onCommit: onSeek,
  });
  const volumeControl = useCommittedRange({
    value: volume,
    min: 0,
    max: 1,
    enabled: volumeEnabled,
    onCommit: onVolume,
  });
  const progress = (seek.value / safeDuration) * 100;
  const VolumeIcon =
    volumeControl.value <= 0.01
      ? VolumeX
      : volumeControl.value < 0.55
        ? Volume1
        : Volume2;

  return (
    <footer className={`transport ${visible ? "transport--visible" : ""}`}>
      <div className="transport__scrub">
        <time>{formatDuration(seek.value)}</time>
        <input
          aria-label="Playback position"
          aria-valuetext={`${formatDuration(seek.value)} of ${formatDuration(durationMs)}`}
          disabled={!seekEnabled}
          type="range"
          min={0}
          max={safeDuration}
          step={1000}
          value={seek.value}
          onPointerDown={seek.begin}
          onKeyDown={seek.begin}
          onChange={seek.onChange}
          onPointerUp={seek.commit}
          onPointerCancel={seek.commit}
          onKeyUp={seek.commit}
          onBlur={seek.commit}
          style={{ "--progress": `${progress}%` } as CSSProperties}
        />
        <time>{formatDuration(durationMs)}</time>
      </div>

      <div className="transport__bar">
        <div className="transport__side transport__side--left">
          <IconButton label="Open library" quiet onClick={onOpenLibrary}>
            <Library size={18} strokeWidth={1.7} />
          </IconButton>
          <span className="transport__hint">Library</span>
        </div>

        <div className="transport__center">
          <IconButton
            label={
              previousEnabled
                ? "Previous track"
                : playbackEnabled
                  ? "Previous unavailable on selected device"
                  : "Choose a playback device first"
            }
            disabled={!previousEnabled}
            quiet
            onClick={onPrevious}
          >
            <SkipBack size={20} fill="currentColor" strokeWidth={1.4} />
          </IconButton>
          <IconButton
            label={
              playPauseEnabled
                ? playing
                  ? "Pause"
                  : "Play"
                : playbackEnabled
                  ? `${playing ? "Pause" : "Play"} unavailable on selected device`
                  : "Choose a playback device first"
            }
            disabled={!playPauseEnabled}
            size="large"
            className="play-button"
            onClick={onPlayPause}
          >
            {playing ? (
              <Pause size={22} fill="currentColor" strokeWidth={1.5} />
            ) : (
              <Play size={22} fill="currentColor" strokeWidth={1.5} />
            )}
          </IconButton>
          <IconButton
            label={
              nextEnabled
                ? "Next track"
                : playbackEnabled
                  ? "Next unavailable on selected device"
                  : "Choose a playback device first"
            }
            disabled={!nextEnabled}
            quiet
            onClick={onNext}
          >
            <SkipForward size={20} fill="currentColor" strokeWidth={1.4} />
          </IconButton>
        </div>

        <div className="transport__side transport__side--right">
          <VolumeIcon size={17} strokeWidth={1.6} aria-hidden="true" />
          <input
            aria-label={
              volumeEnabled
                ? `Volume ${Math.round(volumeControl.value * 100)} percent`
                : "Volume unavailable for the selected device"
            }
            aria-valuetext={`${Math.round(volumeControl.value * 100)} percent`}
            disabled={!volumeEnabled}
            className="volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volumeControl.value}
            onPointerDown={volumeControl.begin}
            onKeyDown={volumeControl.begin}
            onChange={volumeControl.onChange}
            onPointerUp={volumeControl.commit}
            onPointerCancel={volumeControl.commit}
            onKeyUp={volumeControl.commit}
            onBlur={volumeControl.commit}
            style={
              {
                "--volume": `${volumeControl.value * 100}%`,
              } as CSSProperties
            }
          />
          <IconButton label="Choose playback device" quiet onClick={onOpenDevices}>
            <ListMusic size={18} strokeWidth={1.7} />
          </IconButton>
          <IconButton label="Open settings" quiet onClick={onOpenSettings}>
            <Settings2 size={18} strokeWidth={1.7} />
          </IconButton>
        </div>
      </div>
    </footer>
  );
}

interface CommittedRangeOptions {
  value: number;
  min: number;
  max: number;
  enabled: boolean;
  onCommit: (value: number) => void;
}

function useCommittedRange({
  value,
  min,
  max,
  enabled,
  onCommit,
}: CommittedRangeOptions) {
  const initialValue = clampRange(value, min, max);
  const [draftValue, setDraftValue] = useState(initialValue);
  const draftValueRef = useRef(initialValue);
  const externalValueRef = useRef(initialValue);
  const editingRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    externalValueRef.current = clampRange(value, min, max);
    if (editingRef.current && enabled) return;
    const nextValue = externalValueRef.current;
    editingRef.current = false;
    dirtyRef.current = false;
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);
  }, [enabled, max, min, value]);

  const begin = useCallback(() => {
    if (enabled) {
      editingRef.current = true;
    }
  }, [enabled]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = clampRange(
        Number(event.currentTarget.value),
        min,
        max,
      );
      editingRef.current = true;
      dirtyRef.current = true;
      draftValueRef.current = nextValue;
      setDraftValue(nextValue);
    },
    [max, min],
  );

  const commit = useCallback(() => {
    if (!editingRef.current && !dirtyRef.current) return;
    const changed = dirtyRef.current;
    editingRef.current = false;
    dirtyRef.current = false;
    if (!enabled) {
      const nextValue = externalValueRef.current;
      draftValueRef.current = nextValue;
      setDraftValue(nextValue);
      return;
    }
    if (!changed) {
      const nextValue = externalValueRef.current;
      draftValueRef.current = nextValue;
      setDraftValue(nextValue);
      return;
    }
    const nextValue = clampRange(draftValueRef.current, min, max);
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);
    onCommit(nextValue);
  }, [enabled, max, min, onCommit]);

  return {
    value: draftValue,
    begin,
    onChange: handleChange,
    commit,
  };
}

function clampRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
