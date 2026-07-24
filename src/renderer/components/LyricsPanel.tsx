import { AnimatePresence, motion } from "framer-motion";
import type { LyricsLine, LyricsResult } from "../features/lyrics/types";
import { getActiveLyricIndex } from "../features/lyrics/active-line";

interface LyricsPanelProps {
  lyrics: LyricsResult | null;
  positionMs: number;
  offsetMs: number;
  visible: boolean;
}

function windowedLines(lines: LyricsLine[], activeIndex: number) {
  const start = Math.max(0, Math.min(lines.length - 5, activeIndex - 2));
  return lines.slice(start, start + 5).map((line, index) => ({
    line,
    absoluteIndex: start + index,
  }));
}

export function LyricsPanel({
  lyrics,
  positionMs,
  offsetMs,
  visible,
}: LyricsPanelProps) {
  if (!visible) {
    return (
      <section className="lyrics-panel lyrics-panel--hidden" aria-label="Lyrics hidden">
        <p className="eyebrow">Liner notes</p>
        <p className="lyrics-hidden-copy">Press L to bring the words back into view.</p>
      </section>
    );
  }

  if (!lyrics) {
    return (
      <section className="lyrics-panel lyrics-panel--empty" aria-label="Lyrics unavailable">
        <span className="empty-rule" aria-hidden="true" />
        <p className="eyebrow">No words attached</p>
        <h2>This track can stay instrumental.</h2>
        <p>Import a synced .lrc file from the library drawer when you have one.</p>
      </section>
    );
  }

  if (lyrics.kind === "plain") {
    return (
      <section className="lyrics-panel lyrics-panel--plain" aria-label="Plain lyrics">
        <p className="eyebrow">Lyrics · {lyrics.source}</p>
        <div className="plain-lyrics">{lyrics.text}</div>
      </section>
    );
  }

  const activeIndex = getActiveLyricIndex(lyrics.lines, positionMs, offsetMs);
  const visibleLines = windowedLines(lyrics.lines, Math.max(activeIndex, 0));

  return (
    <section
      className="lyrics-panel"
      aria-label={`Synchronized lyrics from ${lyrics.source}`}
      aria-live="off"
    >
      <p className="lyrics-kicker">
        <span>Synced words</span>
        <span aria-hidden="true">/</span>
        <span>{lyrics.source}</span>
      </p>
      <div className="lyrics-viewport">
        <AnimatePresence initial={false} mode="popLayout">
          {visibleLines.map(({ line, absoluteIndex }) => {
            const distance = Math.abs(absoluteIndex - activeIndex);
            const isActive = absoluteIndex === activeIndex;
            return (
              <motion.div
                layout
                key={`${line.startMs}-${line.text}`}
                className={`lyric-line lyric-line--distance-${Math.min(distance, 2)} ${
                  isActive ? "lyric-line--active" : ""
                }`}
                initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
                animate={{
                  opacity: isActive ? 1 : distance === 1 ? 0.42 : 0.16,
                  y: 0,
                  filter: isActive
                    ? "blur(0px)"
                    : distance === 1
                      ? "blur(1.5px)"
                      : "blur(5px)",
                }}
                exit={{ opacity: 0, y: -12, filter: "blur(8px)" }}
                transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                aria-current={isActive ? "true" : undefined}
              >
                <div className="lyric-gutter" aria-hidden="true">
                  <span className="lyric-marker" />
                  {isActive ? (
                    <time>{formatLyricTime(line.startMs)}</time>
                  ) : null}
                </div>
                <p>{line.text}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <p className="lyrics-offset">
        Offset {offsetMs === 0 ? "±0.0" : `${offsetMs > 0 ? "+" : "−"}${Math.abs(offsetMs / 1000).toFixed(1)}`}s
      </p>
    </section>
  );
}

function formatLyricTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
