import { z } from "zod";

import {
  LRCLIB_API_ORIGIN,
  LRCLIB_MAX_RESPONSE_BYTES,
} from "../shared/constants";
import { normalizeLyricsIdentity } from "../shared/lyrics";
import type { LyricsTrackIdentity } from "../shared/types";

const LRCLIB_GET_PATH = "/api/get";
const LRCLIB_CLIENT = "Aura Player/0.1.0 (https://github.com/nandanp1/spotifymacmachine)";
const REQUEST_TIMEOUT_MS = 8_000;
const MINIMUM_REQUEST_DELAY_MS = 250;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1_000;
const DEFAULT_CACHE_ENTRIES = 32;
const DEFAULT_SUCCESS_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MISS_TTL_MS = 5 * 60 * 1_000;

const lrclibResponseSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().max(1_000).optional(),
    trackName: z.string().trim().min(1).max(1_000),
    artistName: z.string().trim().min(1).max(1_000),
    albumName: z.string().max(1_000),
    duration: z.number().finite().positive().max(24 * 60 * 60),
    instrumental: z.boolean(),
    plainLyrics: z.string().max(LRCLIB_MAX_RESPONSE_BYTES).nullable(),
    syncedLyrics: z.string().max(LRCLIB_MAX_RESPONSE_BYTES).nullable(),
    lyricsfile: z.string().max(LRCLIB_MAX_RESPONSE_BYTES).optional(),
  })
  .strict();

const lookupTrackSchema = z
  .object({
    spotifyTrackId: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    artist: z.string().trim().min(1).max(300),
    album: z.string().trim().min(1).max(300),
    durationMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
    isrc: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/)
      .optional(),
  })
  .strict();

type ValidLookupTrack = z.infer<typeof lookupTrackSchema>;

export type LrclibMalformedReason =
  | "body-too-large"
  | "invalid-json"
  | "invalid-schema"
  | "identity-mismatch"
  | "invalid-synced-lyrics";

export type LrclibNetworkReason =
  | "network"
  | "timeout"
  | "http-error"
  | "redirect-rejected";

export type LrclibLyricsOutcome =
  | {
      status: "found";
      provider: "lrclib";
      source: "LRCLIB";
      recordId: number;
      syncedLyrics: string;
    }
  | {
      status: "instrumental";
      provider: "lrclib";
      source: "LRCLIB";
      recordId: number;
    }
  | {
      status: "not-found";
      provider: "lrclib";
    }
  | {
      status: "invalid-track";
      provider: "lrclib";
      reason: "invalid-metadata";
    }
  | {
      status: "rate-limited";
      provider: "lrclib";
      retryAfterMs: number;
    }
  | {
      status: "network-error";
      provider: "lrclib";
      reason: LrclibNetworkReason;
      httpStatus?: number;
    }
  | {
      status: "malformed-response";
      provider: "lrclib";
      reason: LrclibMalformedReason;
    };

export interface LrclibLyricsServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  maxCacheEntries?: number;
  successTtlMs?: number;
  missTtlMs?: number;
}

interface CacheEntry {
  outcome: CacheableOutcome;
  expiresAt: number;
}

interface InFlightLookup {
  controller: AbortController;
  promise: Promise<LrclibLyricsOutcome>;
  settled: boolean;
  waiters: number;
}

type CacheableOutcome = Extract<
  LrclibLyricsOutcome,
  { status: "found" | "instrumental" | "not-found" }
>;

type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "body-too-large" | "invalid-json" };

/**
 * A main-process-only client for LRCLIB's exact-signature lookup endpoint.
 * It intentionally owns no persistence and never accepts a renderer-provided
 * origin, path, header, or credential.
 */
export class LrclibLyricsService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly maxCacheEntries: number;
  private readonly successTtlMs: number;
  private readonly missTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightLookup>();

  private cacheGeneration = 0;
  private networkQueue: Promise<void> = Promise.resolve();
  private nextNetworkRequestAt = 0;
  private rateLimitedUntil = 0;

  constructor(options: LrclibLyricsServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
    this.maxCacheEntries = boundedInteger(
      options.maxCacheEntries,
      DEFAULT_CACHE_ENTRIES,
      1,
      1_000,
    );
    this.successTtlMs = boundedInteger(
      options.successTtlMs,
      DEFAULT_SUCCESS_TTL_MS,
      1,
      24 * 60 * 60 * 1_000,
    );
    this.missTtlMs = boundedInteger(
      options.missTtlMs,
      DEFAULT_MISS_TTL_MS,
      1,
      24 * 60 * 60 * 1_000,
    );
  }

  async lookup(
    track: LyricsTrackIdentity,
    signal?: AbortSignal,
  ): Promise<LrclibLyricsOutcome> {
    throwIfAborted(signal);
    const parsedTrack = lookupTrackSchema.safeParse(track);
    if (!parsedTrack.success) {
      return {
        status: "invalid-track",
        provider: "lrclib",
        reason: "invalid-metadata",
      };
    }

    const cacheKey = createCacheKey(parsedTrack.data);
    const cached = this.readCache(cacheKey);
    if (cached) {
      return cached;
    }
    const retryAfterMs = Math.max(0, this.rateLimitedUntil - this.now());
    if (retryAfterMs > 0) {
      return {
        status: "rate-limited",
        provider: "lrclib",
        retryAfterMs,
      };
    }

    const entry =
      this.inFlight.get(cacheKey) ??
      this.createInFlightLookup(cacheKey, parsedTrack.data);
    return this.waitForLookup(entry, signal);
  }

  clearCache(): void {
    this.cacheGeneration += 1;
    this.cache.clear();
  }

  private createInFlightLookup(
    cacheKey: string,
    track: ValidLookupTrack,
  ): InFlightLookup {
    const cacheGeneration = this.cacheGeneration;
    const controller = new AbortController();
    const entry: InFlightLookup = {
      controller,
      promise: Promise.resolve({
        status: "not-found",
        provider: "lrclib",
      }),
      settled: false,
      waiters: 0,
    };

    entry.promise = this.enqueueNetworkLookup(track, controller.signal)
      .then((outcome) => {
        if (
          isCacheable(outcome) &&
          cacheGeneration === this.cacheGeneration
        ) {
          this.writeCache(cacheKey, outcome);
        }
        return outcome;
      })
      .finally(() => {
        entry.settled = true;
        if (this.inFlight.get(cacheKey) === entry) {
          this.inFlight.delete(cacheKey);
        }
      });
    this.inFlight.set(cacheKey, entry);
    return entry;
  }

  private waitForLookup(
    entry: InFlightLookup,
    signal?: AbortSignal,
  ): Promise<LrclibLyricsOutcome> {
    entry.waiters += 1;
    let finished = false;

    return new Promise<LrclibLyricsOutcome>((resolve, reject) => {
      const finish = (
        operation: () => void,
      ): void => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", handleAbort);
        entry.waiters = Math.max(0, entry.waiters - 1);
        operation();
        if (entry.waiters === 0 && !entry.settled) {
          entry.controller.abort(
            new DOMException("The lyrics lookup was aborted.", "AbortError"),
          );
        }
      };
      const handleAbort = () => {
        finish(() => reject(abortReason(signal)));
      };

      signal?.addEventListener("abort", handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }

      void entry.promise.then(
        (outcome) => finish(() => resolve(outcome)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  private enqueueNetworkLookup(
    track: ValidLookupTrack,
    signal: AbortSignal,
  ): Promise<LrclibLyricsOutcome> {
    const operation = this.networkQueue.then(async () => {
      throwIfAborted(signal);
      const retryAfterMs = Math.max(0, this.rateLimitedUntil - this.now());
      if (retryAfterMs > 0) {
        return {
          status: "rate-limited" as const,
          provider: "lrclib" as const,
          retryAfterMs,
        };
      }
      const delayMs = Math.max(0, this.nextNetworkRequestAt - this.now());
      if (delayMs > 0) {
        await this.sleep(delayMs, signal);
      }
      throwIfAborted(signal);

      try {
        return await this.performNetworkLookup(track, signal);
      } finally {
        this.nextNetworkRequestAt = Math.max(
          this.nextNetworkRequestAt,
          this.now() + MINIMUM_REQUEST_DELAY_MS,
        );
      }
    });
    this.networkQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performNetworkLookup(
    track: ValidLookupTrack,
    callerSignal: AbortSignal,
  ): Promise<LrclibLyricsOutcome> {
    const requestController = new AbortController();
    let timedOut = false;
    const forwardAbort = () => {
      requestController.abort(abortReason(callerSignal));
    };
    callerSignal.addEventListener("abort", forwardAbort, { once: true });
    if (callerSignal.aborted) {
      forwardAbort();
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort(
        new DOMException("The LRCLIB request timed out.", "TimeoutError"),
      );
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(createLookupUrl(track), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Lrclib-Client": LRCLIB_CLIENT,
        },
        redirect: "manual",
        signal: requestController.signal,
      });

      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400) ||
        !isExpectedResponseUrl(response.url)
      ) {
        return {
          status: "network-error",
          provider: "lrclib",
          reason: "redirect-rejected",
          httpStatus: response.status,
        };
      }
      if (response.status === 404) {
        return { status: "not-found", provider: "lrclib" };
      }
      if (response.status === 429) {
        const retryAfterMs = readRetryAfterMs(
          response.headers.get("retry-after"),
          this.now(),
        );
        this.rateLimitedUntil = Math.max(
          this.rateLimitedUntil,
          this.now() + retryAfterMs,
        );
        return {
          status: "rate-limited",
          provider: "lrclib",
          retryAfterMs,
        };
      }
      if (!response.ok) {
        return {
          status: "network-error",
          provider: "lrclib",
          reason: "http-error",
          httpStatus: response.status,
        };
      }

      const body = await readLimitedBody(
        response,
        requestController.signal,
      );
      if (!body.ok) {
        return {
          status: "malformed-response",
          provider: "lrclib",
          reason: body.reason,
        };
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(body.text);
      } catch {
        return {
          status: "malformed-response",
          provider: "lrclib",
          reason: "invalid-json",
        };
      }
      const parsed = lrclibResponseSchema.safeParse(decoded);
      if (!parsed.success) {
        return {
          status: "malformed-response",
          provider: "lrclib",
          reason: "invalid-schema",
        };
      }
      if (!responseMatchesTrack(parsed.data, track)) {
        return {
          status: "malformed-response",
          provider: "lrclib",
          reason: "identity-mismatch",
        };
      }
      if (parsed.data.instrumental) {
        return {
          status: "instrumental",
          provider: "lrclib",
          source: "LRCLIB",
          recordId: parsed.data.id,
        };
      }

      const syncedLyrics = parsed.data.syncedLyrics;
      if (syncedLyrics === null || syncedLyrics.trim() === "") {
        return { status: "not-found", provider: "lrclib" };
      }
      if (!containsLrcTimestamp(syncedLyrics)) {
        return {
          status: "malformed-response",
          provider: "lrclib",
          reason: "invalid-synced-lyrics",
        };
      }
      return {
        status: "found",
        provider: "lrclib",
        source: "LRCLIB",
        recordId: parsed.data.id,
        syncedLyrics,
      };
    } catch (error) {
      if (callerSignal.aborted) {
        throw abortReason(callerSignal);
      }
      if (timedOut) {
        return {
          status: "network-error",
          provider: "lrclib",
          reason: "timeout",
        };
      }
      if (isAbortError(error) && requestController.signal.aborted) {
        return {
          status: "network-error",
          provider: "lrclib",
          reason: "timeout",
        };
      }
      return {
        status: "network-error",
        provider: "lrclib",
        reason: "network",
      };
    } finally {
      clearTimeout(timeout);
      callerSignal.removeEventListener("abort", forwardAbort);
    }
  }

  private readCache(cacheKey: string): CacheableOutcome | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(cacheKey);
      return null;
    }

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);
    return entry.outcome;
  }

  private writeCache(cacheKey: string, outcome: CacheableOutcome): void {
    const ttlMs =
      outcome.status === "not-found" ? this.missTtlMs : this.successTtlMs;
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, {
      outcome,
      expiresAt: this.now() + ttlMs,
    });
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.cache.delete(oldestKey);
    }
  }
}

function createLookupUrl(track: ValidLookupTrack): string {
  const url = new URL(LRCLIB_GET_PATH, LRCLIB_API_ORIGIN);
  url.searchParams.set("track_name", track.title);
  url.searchParams.set("artist_name", track.artist);
  url.searchParams.set("album_name", track.album);
  url.searchParams.set("duration", String(durationSeconds(track.durationMs)));
  return url.toString();
}

function createCacheKey(track: ValidLookupTrack): string {
  return [
    normalizeLyricsIdentity(track.title),
    normalizeLyricsIdentity(track.artist),
    normalizeLyricsIdentity(track.album),
    durationSeconds(track.durationMs),
  ].join("\u0000");
}

function durationSeconds(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 1_000));
}

function responseMatchesTrack(
  response: z.infer<typeof lrclibResponseSchema>,
  track: ValidLookupTrack,
): boolean {
  return (
    normalizeLyricsIdentity(response.trackName) ===
      normalizeLyricsIdentity(track.title) &&
    normalizeLyricsIdentity(response.artistName) ===
      normalizeLyricsIdentity(track.artist) &&
    normalizeLyricsIdentity(response.albumName) ===
      normalizeLyricsIdentity(track.album) &&
    Math.abs(response.duration - durationSeconds(track.durationMs)) <= 2
  );
}

function containsLrcTimestamp(value: string): boolean {
  return /\[(?:(?:\d{1,2}):)?\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?\]/u.test(
    value,
  );
}

function isCacheable(outcome: LrclibLyricsOutcome): outcome is CacheableOutcome {
  return (
    outcome.status === "found" ||
    outcome.status === "instrumental" ||
    outcome.status === "not-found"
  );
}

function isExpectedResponseUrl(value: string): boolean {
  if (value === "") {
    // Synthetic Response objects used by deterministic tests do not expose URL.
    return true;
  }
  try {
    const url = new URL(value);
    return (
      url.origin === LRCLIB_API_ORIGIN &&
      url.pathname === LRCLIB_GET_PATH &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function readRetryAfterMs(value: string | null, now: number): number {
  if (value !== null && value.trim() !== "") {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(
        MAX_RATE_LIMIT_COOLDOWN_MS,
        Math.max(0, Math.ceil(seconds * 1_000)),
      );
    }
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return Math.min(
        MAX_RATE_LIMIT_COOLDOWN_MS,
        Math.max(0, timestamp - now),
      );
    }
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

async function readLimitedBody(
  response: Response,
  signal: AbortSignal,
): Promise<BodyReadResult> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > LRCLIB_MAX_RESPONSE_BYTES
    ) {
      return { ok: false, reason: "body-too-large" };
    }
  }

  if (!response.body) {
    try {
      const bytes = new Uint8Array(
        await raceWithAbort(response.arrayBuffer(), signal),
      );
      if (bytes.byteLength > LRCLIB_MAX_RESPONSE_BYTES) {
        return { ok: false, reason: "body-too-large" };
      }
      return {
        ok: true,
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    } catch {
      if (signal.aborted) throw abortReason(signal);
      return { ok: false, reason: "invalid-json" };
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await raceWithAbort(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > LRCLIB_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return { ok: false, reason: "body-too-large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    if (signal.aborted) throw abortReason(signal);
    return { ok: false, reason: "invalid-json" };
  } finally {
    reader.releaseLock();
  }
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The lyrics lookup was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value ?? fallback));
}
