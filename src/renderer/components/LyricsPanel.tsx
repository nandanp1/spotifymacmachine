import { motion, useReducedMotion } from "framer-motion";
import { useMemo, type CSSProperties } from "react";

import {
  getLyricsTimelineState,
} from "../features/lyrics/active-line";
import type { LyricsResult } from "../features/lyrics/types";
import { useActiveLyricScroll } from "../hooks/use-active-lyric-scroll";

export type LyricsPanelStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

interface LyricsPanelProps {
  lyrics: LyricsResult | null;
  positionMs: number;
  offsetMs: number;
  visible: boolean;
  trackKey?: string;
  trackTitle?: string;
  status?: LyricsPanelStatus;
  errorMessage?: string;
  onImport?: () => void;
}

export function LyricsPanel({
  lyrics,
  positionMs,
  offsetMs,
  visible,
  trackKey = "current-track",
  trackTitle,
  status = lyrics ? "ready" : "unavailable",
  errorMessage,
  onImport,
}: LyricsPanelProps) {
  const reducedMotion = useReducedMotion() === true;

  if (!visible) {
    return (
      <section
        className="lyrics-panel lyrics-panel--hidden"
        aria-label="Lyrics hidden"
      >
        <p className="eyebrow">Liner notes</p>
        <p className="lyrics-hidden-copy">
          Press L to bring the words back into view.
        </p>
      </section>
    );
  }

  if (status === "loading" && !lyrics) {
    return (
      <motion.section
        className="lyrics-panel lyrics-panel--loading"
        aria-label="Checking for saved lyrics"
        role="status"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <p className="eyebrow">Opening the lyric shelf</p>
        <h2>Looking for the right page.</h2>
        <div className="lyrics-loading-score" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>
          Aura is matching this track with lyric sheets already saved on your
          Mac.
        </p>
      </motion.section>
    );
  }

  if (status === "error" && !lyrics) {
    return (
      <LyricsEmptyState
        eyebrow="The page would not open"
        title="Saved lyrics hit a snag."
        description={
          errorMessage ??
          "Try importing the synchronized lyric sheet for this track again."
        }
        actionLabel="Choose another .lrc"
        onAction={onImport}
        reducedMotion={reducedMotion}
      />
    );
  }

  if (status === "idle" && !lyrics) {
    return (
      <LyricsEmptyState
        eyebrow="Waiting at the first bar"
        title="Start a track to open its page."
        description="Choose a Spotify device, then play something. Aura will check the lyric sheets saved on this Mac automatically."
        actionLabel="Import synced .lrc"
        reducedMotion={reducedMotion}
      />
    );
  }

  if (!lyrics || (lyrics.kind === "synced" && !lyrics.lines.length)) {
    return (
      <LyricsEmptyState
        eyebrow="No lyric sheet found"
        title="The music can keep the room."
        description={
          trackTitle
            ? `Spotify does not provide lyric text to Aura for “${trackTitle}.” Import a licensed .lrc once and Aura will match it automatically next time.`
            : "Import a licensed synchronized .lrc once and Aura will match it automatically next time."
        }
        actionLabel="Import synced .lrc"
        onAction={onImport}
        reducedMotion={reducedMotion}
      />
    );
  }

  if (lyrics.kind === "plain") {
    return (
      <motion.section
        className="lyrics-panel lyrics-panel--plain"
        aria-label={`Plain lyrics from ${lyrics.source}`}
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.45 }}
      >
        <p className="lyrics-kicker lyrics-kicker--plain">
          <span>Words · unsynced</span>
          <span aria-hidden="true">/</span>
          <span>{lyrics.source}</span>
        </p>
        <div
          className="plain-lyrics"
          role="region"
          tabIndex={0}
          aria-label="Scrollable plain lyrics"
        >
          {lyrics.text}
        </div>
      </motion.section>
    );
  }

  return (
    <SyncedLyricsScore
      lyrics={lyrics}
      positionMs={positionMs}
      offsetMs={offsetMs}
      trackKey={trackKey}
      reducedMotion={reducedMotion}
    />
  );
}

interface SyncedLyricsScoreProps {
  lyrics: Extract<LyricsResult, { kind: "synced" }>;
  positionMs: number;
  offsetMs: number;
  trackKey: string;
  reducedMotion: boolean;
}

function SyncedLyricsScore({
  lyrics,
  positionMs,
  offsetMs,
  trackKey,
  reducedMotion,
}: SyncedLyricsScoreProps) {
  const timeline = getLyricsTimelineState(
    lyrics.lines,
    positionMs,
    offsetMs,
  );
  const { viewportRef, scoreRef, getLineRef } = useActiveLyricScroll({
    anchorIndex: timeline.anchorIndex,
    trackKey,
    offsetMs,
    reducedMotion,
  });
  const hasDeterminateProgress = timeline.progress !== null;
  const timingState =
    timeline.activeIndex < 0
      ? "quiet"
      : hasDeterminateProgress
        ? "bounded"
        : "indeterminate";
  const lineNodes = useMemo(
    () =>
      lyrics.lines.map((line, index) => {
        const isActive = index === timeline.activeIndex;
        const isPast =
          timeline.phase === "after" || index < timeline.anchorIndex;
        const isFuture =
          timeline.phase === "before" ||
          index > timeline.anchorIndex ||
          (timeline.phase === "gap" && index === timeline.anchorIndex);
        const distance = Math.min(
          3,
          Math.abs(index - Math.max(timeline.anchorIndex, 0)),
        );
        const isInstrumental = line.instrumental === true || !line.text;

        return (
          <li
            ref={getLineRef(index)}
            key={`${index}-${line.startMs}`}
            className={`lyric-line lyric-line--distance-${distance} ${
              isActive ? "lyric-line--active" : ""
            } ${isPast ? "lyric-line--past" : ""} ${
              isFuture ? "lyric-line--future" : ""
            } ${isInstrumental ? "lyric-line--instrumental" : ""} ${
              isActive && !hasDeterminateProgress
                ? "lyric-line--indeterminate"
                : ""
            }`}
            aria-current={isActive ? "time" : undefined}
          >
            <div className="lyric-gutter" aria-hidden="true">
              <span className="lyric-marker">
                <span className="lyric-marker__fill" />
              </span>
              {isActive ? (
                <time>{formatLyricTime(line.startMs)}</time>
              ) : (
                <span className="lyric-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
              )}
            </div>
            <p>
              {isActive ? (
                <span className="sr-only">Current line: </span>
              ) : null}
              {isInstrumental ? (
                <>
                  <span className="sr-only">Instrumental passage</span>
                  <span className="instrumental-motif" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </>
              ) : (
                line.text
              )}
            </p>
          </li>
        );
      }),
    [
      getLineRef,
      hasDeterminateProgress,
      lyrics.lines,
      timeline.activeIndex,
      timeline.anchorIndex,
      timeline.phase,
    ],
  );
  const exposureOpacity =
    timeline.activeIndex < 0
      ? 0
      : reducedMotion
        ? 0.42
        : timeline.progress === null
          ? 0.38
          : 0.16 + Math.sin(timeline.progress * Math.PI) * 0.52;
  const scoreStyle = {
    "--lyric-progress": timeline.progress ?? 0,
    "--lyric-exposure-opacity": exposureOpacity.toFixed(3),
  } as CSSProperties;

  return (
    <section
      className={`lyrics-panel lyrics-panel--score ${
        reducedMotion ? "lyrics-panel--reduced-motion" : ""
      }`}
      data-phase={timeline.phase}
      aria-label={`Synchronized lyrics from ${lyrics.source}`}
      aria-live="off"
    >
      <p className="lyrics-kicker">
        <span>Darkroom score</span>
        <span aria-hidden="true">/</span>
        <span>{lyrics.source}</span>
      </p>
      <div
        ref={viewportRef}
        className="lyrics-viewport"
        role="region"
        tabIndex={0}
        aria-label="Scrollable synchronized lyric transcript"
      >
        <span className="lyrics-reading-axis" aria-hidden="true" />
        <ol
          ref={scoreRef}
          className="lyrics-score"
          style={scoreStyle}
          data-phase={timeline.phase}
          data-timing={timingState}
          data-progress={
            timingState !== "bounded" || timeline.progress === null
              ? undefined
              : timeline.progress.toFixed(3)
          }
        >
          {lineNodes}
        </ol>
      </div>
      <p className="lyrics-offset">
        <span>
          Offset{" "}
          {offsetMs === 0
            ? "±0.0"
            : `${offsetMs > 0 ? "+" : "−"}${Math.abs(offsetMs / 1000).toFixed(1)}`}
          s
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {timeline.phase === "gap"
            ? "instrumental space"
            : timeline.phase === "before"
              ? "awaiting first line"
              : timeline.phase === "after"
                ? "final bar"
                : "following playback"}
        </span>
      </p>
    </section>
  );
}

interface LyricsEmptyStateProps {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
  reducedMotion: boolean;
}

function LyricsEmptyState({
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
  reducedMotion,
}: LyricsEmptyStateProps) {
  return (
    <motion.section
      className="lyrics-panel lyrics-panel--empty"
      aria-label="Lyrics unavailable"
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.45 }}
    >
      <span className="empty-rule" aria-hidden="true" />
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {onAction ? (
        <button className="lyrics-action" type="button" onClick={onAction}>
          <span aria-hidden="true">＋</span>
          {actionLabel}
        </button>
      ) : null}
    </motion.section>
  );
}

function formatLyricTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
