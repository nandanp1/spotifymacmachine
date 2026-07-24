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
import type { CSSProperties } from "react";
import { formatDuration } from "../lib/format";
import { IconButton } from "./IconButton";

interface TransportProps {
  visible: boolean;
  playing: boolean;
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
  playing,
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
  const progress = Math.min(100, Math.max(0, (positionMs / safeDuration) * 100));
  const VolumeIcon = volume <= 0.01 ? VolumeX : volume < 0.55 ? Volume1 : Volume2;

  return (
    <footer className={`transport ${visible ? "transport--visible" : ""}`}>
      <div className="transport__scrub">
        <time>{formatDuration(positionMs)}</time>
        <input
          aria-label="Playback position"
          type="range"
          min={0}
          max={safeDuration}
          step={1000}
          value={Math.min(positionMs, safeDuration)}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
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
          <IconButton label="Previous track" quiet onClick={onPrevious}>
            <SkipBack size={20} fill="currentColor" strokeWidth={1.4} />
          </IconButton>
          <IconButton
            label={playing ? "Pause" : "Play"}
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
          <IconButton label="Next track" quiet onClick={onNext}>
            <SkipForward size={20} fill="currentColor" strokeWidth={1.4} />
          </IconButton>
        </div>

        <div className="transport__side transport__side--right">
          <VolumeIcon size={17} strokeWidth={1.6} aria-hidden="true" />
          <input
            aria-label={`Volume ${Math.round(volume * 100)} percent`}
            className="volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => onVolume(Number(event.currentTarget.value))}
            style={{ "--volume": `${volume * 100}%` } as CSSProperties}
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
