import { useEffect, useRef } from "react";
import type { VisualMode } from "../../shared/types";
import type { DemoTrack } from "../demo-data";
import { CanvasVisualEngine } from "../features/artwork/canvas-visual-engine";

interface CinematicBackdropProps {
  track: DemoTrack;
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  intensity: number;
  mode: VisualMode;
}

export function CinematicBackdrop({
  track,
  playing,
  buffering,
  positionMs,
  intensity,
  mode,
}: CinematicBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CanvasVisualEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new CanvasVisualEngine();
    engineRef.current = engine;
    void engine.initialize(canvas);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      engine.resize(bounds.width, bounds.height, window.devicePixelRatio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    void engineRef.current?.setTrack({
      trackId: track.id,
      artworkUrl: track.artworkUrl ?? undefined,
      palette:
        track.source === "spotify"
          ? undefined
          : {
              shadow: track.palette.shadow,
              primary: track.palette.primary,
              accent: track.palette.accent,
              highlight: track.palette.highlight,
            },
    });
  }, [
    track.artworkUrl,
    track.id,
    track.palette.accent,
    track.palette.highlight,
    track.palette.primary,
    track.palette.shadow,
    track.source,
  ]);

  useEffect(() => {
    engineRef.current?.setIntensity(intensity);
  }, [intensity]);

  useEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setPlaybackState({
      paused: !playing,
      buffering,
      positionMs,
      durationMs: track.durationMs,
      observedAt: Date.now(),
    });
  }, [buffering, playing, positionMs, track.durationMs]);

  return (
    <div className="visual-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className={`ambient-cover ${track.artworkClass}`} />
      <div className="visual-backdrop__field visual-backdrop__field--a" />
      <div className="visual-backdrop__field visual-backdrop__field--b" />
      <div className="vignette" />
      <div className="grain" />
    </div>
  );
}
