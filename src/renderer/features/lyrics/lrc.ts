import type { LyricsLine, LyricsResult } from "./types";

const MAX_LRC_BYTES = 1_000_000;
const MAX_LRC_LINES = 3_000;
const METADATA_TAG = /^\[([a-z][\w-]*):([^\]]*)\]\s*$/i;
const TIMESTAMP_TAG =
  /\[(?:(\d{1,2}):)?(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
const INLINE_WORD_TIMESTAMP =
  /<(?:\d{1,2}:)?\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?>/g;

export interface LrcMetadata {
  title?: string;
  artist?: string;
  album?: string;
  author?: string;
  length?: string;
  offsetMs: number;
  extra: Record<string, string>;
}

export interface LrcDocument {
  metadata: LrcMetadata;
  lines: LyricsLine[];
  warnings: string[];
}

export interface ParseLrcOptions {
  additionalOffsetMs?: number;
  preserveBlankLines?: boolean;
}

export class LrcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LrcParseError";
  }
}

export function parseLrc(
  input: string,
  options: ParseLrcOptions = {},
): LrcDocument {
  if (new Blob([input]).size > MAX_LRC_BYTES) {
    throw new LrcParseError("The .lrc file is larger than the 1 MB limit.");
  }

  const warnings: string[] = [];
  const rawLines = input
    .replace(/^\uFEFF/, "")
    .replace(/\0/g, "")
    .split(/\r\n?|\n/);
  const metadata = readMetadata(rawLines, warnings);
  const additionalOffsetMs = Number.isFinite(options.additionalOffsetMs)
    ? Math.round(options.additionalOffsetMs ?? 0)
    : 0;
  const totalOffsetMs = metadata.offsetMs + additionalOffsetMs;
  const parsed: Array<LyricsLine & { order: number }> = [];

  rawLines.forEach((rawLine, sourceLineIndex) => {
    if (METADATA_TAG.test(rawLine.trim())) {
      return;
    }
    METADATA_TAG.lastIndex = 0;

    const timestamps: number[] = [];
    TIMESTAMP_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastTimestampEnd = 0;
    while ((match = TIMESTAMP_TAG.exec(rawLine)) !== null) {
      const timestamp = timestampMatchToMilliseconds(match);
      if (timestamp !== null) {
        timestamps.push(timestamp);
        lastTimestampEnd = TIMESTAMP_TAG.lastIndex;
      }
    }

    if (!timestamps.length) {
      if (rawLine.trim().startsWith("[") && rawLine.trim().endsWith("]")) {
        warnings.push(`Ignored an unrecognized tag on line ${sourceLineIndex + 1}.`);
      }
      return;
    }

    const text = rawLine
      .slice(lastTimestampEnd)
      .replace(INLINE_WORD_TIMESTAMP, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text && options.preserveBlankLines === false) {
      return;
    }

    timestamps.forEach((timestamp, timestampIndex) => {
      if (parsed.length >= MAX_LRC_LINES) {
        throw new LrcParseError(
          `This file contains more than ${MAX_LRC_LINES.toLocaleString()} timed lyric lines.`,
        );
      }
      parsed.push({
        startMs: Math.max(0, timestamp + totalOffsetMs),
        text,
        instrumental: text.length === 0,
        order: sourceLineIndex * 100 + timestampIndex,
      });
    });
  });

  parsed.sort(
    (left, right) => left.startMs - right.startMs || left.order - right.order,
  );

  const deduped = parsed.filter(
    (line, index, all) => {
      const previous = all[index - 1];
      return (
        !previous ||
        line.startMs !== previous.startMs ||
        line.text !== previous.text
      );
    },
  );

  const lines: LyricsLine[] = deduped.map((line, index) => {
    let nextStart: number | undefined;
    for (let cursor = index + 1; cursor < deduped.length; cursor += 1) {
      const candidate = deduped[cursor];
      if (candidate && candidate.startMs > line.startMs) {
        nextStart = candidate.startMs;
        break;
      }
    }

    return {
      startMs: line.startMs,
      endMs: nextStart,
      text: line.text,
      instrumental: line.instrumental,
    };
  });

  if (!lines.length) {
    warnings.push("No synchronized lyric timestamps were found.");
  }

  return {
    metadata,
    lines,
    warnings,
  };
}

export function parseLrcLyrics(
  input: string,
  source = "Imported .lrc",
  options?: ParseLrcOptions,
): LyricsResult {
  const document = parseLrc(input, options);
  if (!document.lines.length) {
    throw new LrcParseError(
      "This file does not contain recognizable synchronized lyrics.",
    );
  }
  return {
    kind: "synced",
    source,
    lines: document.lines,
  };
}

export function parseLrcTimestamp(value: string): number | null {
  const wrapped = value.startsWith("[") ? value : `[${value}]`;
  TIMESTAMP_TAG.lastIndex = 0;
  const match = TIMESTAMP_TAG.exec(wrapped);
  if (!match || match[0].length !== wrapped.length) {
    return null;
  }
  return timestampMatchToMilliseconds(match);
}

function readMetadata(
  lines: string[],
  warnings: string[],
): LrcMetadata {
  const metadata: LrcMetadata = {
    offsetMs: 0,
    extra: {},
  };

  for (const line of lines) {
    const match = METADATA_TAG.exec(line.trim());
    if (!match) {
      continue;
    }
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim();
    if (!key || value === undefined) {
      continue;
    }

    if (key === "offset") {
      const offset = Number(value);
      if (Number.isFinite(offset)) {
        metadata.offsetMs = Math.round(offset);
      } else {
        warnings.push("Ignored an invalid [offset] tag.");
      }
      continue;
    }

    if (key === "ti") {
      metadata.title = value;
    } else if (key === "ar") {
      metadata.artist = value;
    } else if (key === "al") {
      metadata.album = value;
    } else if (key === "by") {
      metadata.author = value;
    } else if (key === "length") {
      metadata.length = value;
    } else {
      metadata.extra[key] = value;
    }
  }

  return metadata;
}

function timestampMatchToMilliseconds(
  match: RegExpExecArray,
): number | null {
  const hours = Number(match[1] ?? 0);
  const minutesText = match[2];
  const secondsText = match[3];
  if (minutesText === undefined || secondsText === undefined) {
    return null;
  }
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    seconds >= 60
  ) {
    return null;
  }

  const fractionText = match[4] ?? "";
  const milliseconds = fractionText
    ? Number(fractionText.padEnd(3, "0").slice(0, 3))
    : 0;

  return (
    Math.round(hours * 3_600_000) +
    Math.round(minutes * 60_000) +
    Math.round(seconds * 1_000) +
    milliseconds
  );
}
