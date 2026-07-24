import { motion } from "framer-motion";
import type { DemoTrack } from "../demo-data";

interface ArtworkStageProps {
  track: DemoTrack;
  artworkScale: number;
  onToggleFullscreen: () => void;
}

export function ArtworkStage({
  track,
  artworkScale,
  onToggleFullscreen,
}: ArtworkStageProps) {
  return (
    <section className="artwork-stage" aria-label="Now playing artwork and track">
      <div className="folio-mark" aria-hidden="true">
        <span>{track.folio}</span>
        <span>{Math.round(track.durationMs / 1000)} SEC</span>
      </div>

      <motion.button
        key={track.id}
        className="artwork-button"
        type="button"
        aria-label={`Album artwork for ${track.album}. Double-click for fullscreen.`}
        onDoubleClick={onToggleFullscreen}
        initial={{ opacity: 0, filter: "blur(14px)", scale: 0.975 }}
        animate={{ opacity: 1, filter: "blur(0px)", scale: artworkScale }}
        transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className={`album-art ${track.artworkClass}`} aria-hidden="true">
          {track.artworkUrl ? (
            <img className="album-art__image" src={track.artworkUrl} alt="" />
          ) : (
            <>
              <span className="album-art__halo" />
              <span className="album-art__plane album-art__plane--one" />
              <span className="album-art__plane album-art__plane--two" />
              <span className="album-art__type">
                <span>{track.artist}</span>
                <strong>{track.title}</strong>
              </span>
            </>
          )}
        </span>
        <span className="artwork-reflection" aria-hidden="true" />
      </motion.button>

      <motion.div
        key={`${track.id}-meta`}
        className="track-meta"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.58, delay: 0.08 }}
      >
        <p className="eyebrow">{track.artist}</p>
        <h1>{track.title}</h1>
        <p className="album-meta">
          {track.album} <span aria-hidden="true">·</span> {track.year}
        </p>
      </motion.div>
    </section>
  );
}
