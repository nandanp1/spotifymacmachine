import type { LrclibLyricsLookupResult } from "../../../shared/types";
import { parseLrcLyrics } from "./lrc";
import type { LyricsResult } from "./types";

export type LrclibResolution =
  | {
      kind: "lyrics";
      lyrics: LyricsResult;
    }
  | {
      kind: "unavailable";
      message: string;
    }
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "disabled";
    };

const LRCLIB_SOURCE = "LRCLIB community sync";

export function resolveLrclibLookup(
  result: LrclibLyricsLookupResult,
  trackTitle: string,
): LrclibResolution {
  switch (result.status) {
    case "found": {
      if (result.format === "lrc") {
        const parsed = parseLrcLyrics(result.content, LRCLIB_SOURCE);
        return {
          kind: "lyrics",
          lyrics: {
            ...parsed,
            source: LRCLIB_SOURCE,
          },
        };
      }

      return {
        kind: "lyrics",
        lyrics: {
          kind: "plain",
          source: "LRCLIB community",
          text: result.content.trim(),
        },
      };
    }
    case "not-found":
      return {
        kind: "unavailable",
        message: `LRCLIB did not find lyrics for “${trackTitle}.” You can still import a licensed .lrc file.`,
      };
    case "instrumental":
      return {
        kind: "unavailable",
        message: `LRCLIB marks “${trackTitle}” as instrumental, so there are no lyric lines to display.`,
      };
    case "rate-limited":
      return {
        kind: "unavailable",
        message: `LRCLIB is cooling down. Aura can try this track again in about ${formatRetryDelay(
          result.retryAfterMs,
        )}.`,
      };
    case "error":
      return {
        kind: "error",
        message:
          result.code === "timeout"
            ? "LRCLIB took too long to respond. Try the track again in a moment."
            : result.code === "invalid-response"
              ? "LRCLIB returned lyrics Aura could not safely read."
              : "Aura could not reach LRCLIB. Check the network and try again.",
      };
    case "disabled":
      return { kind: "disabled" };
  }
}

function formatRetryDelay(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
