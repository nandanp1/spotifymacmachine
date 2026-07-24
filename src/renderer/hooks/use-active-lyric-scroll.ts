import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefCallback,
  type RefObject,
} from "react";

interface ActiveLyricScrollOptions {
  anchorIndex: number;
  trackKey: string;
  offsetMs: number;
  reducedMotion: boolean;
}

interface ActiveLyricScroll {
  viewportRef: RefObject<HTMLDivElement | null>;
  scoreRef: RefObject<HTMLOListElement | null>;
  getLineRef(index: number): RefCallback<HTMLLIElement>;
}

interface PreviousAnchor {
  index: number;
  trackKey: string;
  offsetMs: number;
}

interface LyricsGeometry {
  viewportWidth: number;
  viewportHeight: number;
  scoreWidth: number;
  scoreHeight: number;
  lineTop: number;
  lineWidth: number;
  lineHeight: number;
}

function geometryChanged(
  previous: LyricsGeometry,
  next: LyricsGeometry,
): boolean {
  return (
    previous.viewportWidth !== next.viewportWidth ||
    previous.viewportHeight !== next.viewportHeight ||
    previous.scoreWidth !== next.scoreWidth ||
    previous.scoreHeight !== next.scoreHeight ||
    previous.lineTop !== next.lineTop ||
    previous.lineWidth !== next.lineWidth ||
    previous.lineHeight !== next.lineHeight
  );
}

/**
 * Holds the current lyric near a fixed optical axis. Progress-only renders do
 * not scroll, while ordinary adjacent line changes settle smoothly.
 */
export function useActiveLyricScroll({
  anchorIndex,
  trackKey,
  offsetMs,
  reducedMotion,
}: ActiveLyricScrollOptions): ActiveLyricScroll {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLOListElement>(null);
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);
  const lineRefCallbacks = useRef<Array<RefCallback<HTMLLIElement>>>([]);
  const previousAnchorRef = useRef<PreviousAnchor | null>(null);

  const getLineRef = useCallback((index: number) => {
    const existing = lineRefCallbacks.current[index];
    if (existing) {
      return existing;
    }
    const callback: RefCallback<HTMLLIElement> = (node) => {
      lineRefs.current[index] = node;
    };
    lineRefCallbacks.current[index] = callback;
    return callback;
  }, []);

  useLayoutEffect(() => {
    if (anchorIndex < 0) {
      previousAnchorRef.current = null;
      return;
    }

    const viewport = viewportRef.current;
    const score = scoreRef.current;
    const line = lineRefs.current[anchorIndex];
    if (!viewport || !line) {
      return;
    }

    const alignLine = (behavior: ScrollBehavior) => {
      const top = Math.max(
        0,
        line.offsetTop -
          viewport.clientHeight * 0.44 +
          line.offsetHeight / 2,
      );
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top, behavior });
      } else {
        viewport.scrollTop = top;
      }
    };

    const previous = previousAnchorRef.current;
    const isAdjacent =
      previous !== null &&
      previous.trackKey === trackKey &&
      previous.offsetMs === offsetMs &&
      Math.abs(previous.index - anchorIndex) === 1;
    alignLine(!reducedMotion && isAdjacent ? "smooth" : "auto");
    previousAnchorRef.current = {
      index: anchorIndex,
      trackKey,
      offsetMs,
    };

    const readGeometry = (): LyricsGeometry => ({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      scoreWidth: score?.offsetWidth ?? 0,
      scoreHeight: score?.offsetHeight ?? 0,
      lineTop: line.offsetTop,
      lineWidth: line.offsetWidth,
      lineHeight: line.offsetHeight,
    });
    let geometry = readGeometry();
    const reanchorIfGeometryChanged = () => {
      const nextGeometry = readGeometry();
      if (!geometryChanged(geometry, nextGeometry)) {
        return;
      }
      geometry = nextGeometry;
      alignLine("auto");
    };
    window.addEventListener("resize", reanchorIfGeometryChanged);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(reanchorIfGeometryChanged);
      resizeObserver.observe(viewport);
      if (score) {
        resizeObserver.observe(score);
      }
      resizeObserver.observe(line);
    }

    let cancelled = false;
    if (
      typeof document !== "undefined" &&
      document.fonts?.status !== "loaded"
    ) {
      void document.fonts?.ready.then(() => {
        if (!cancelled) {
          reanchorIfGeometryChanged();
        }
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", reanchorIfGeometryChanged);
      resizeObserver?.disconnect();
    };
  }, [anchorIndex, offsetMs, reducedMotion, trackKey]);

  return {
    viewportRef,
    scoreRef,
    getLineRef,
  };
}
