import { parseLrcLyrics } from "./lrc";
import {
  normalizeLyricsIdentity,
  scoreLyricsIdentity,
} from "../../../shared/lyrics";
import type {
  ImportedLrcDeleteResult,
  ImportedLrcFile,
  ImportedLrcRecord,
} from "../../../shared/types";
import {
  LyricsProviderError,
  type LyricsProvider,
  type LyricsResult,
  type TrackIdentity,
} from "./types";

export interface LocalLrcEntry {
  id: string;
  fileName: string;
  contents: string;
  spotifyTrackId?: string;
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  importedAt?: number;
}

export interface LocalLrcPersistence {
  listImported(): Promise<ImportedLrcRecord[]>;
  readImported(id: string): Promise<ImportedLrcFile | null>;
  matchImported(track: TrackIdentity): Promise<ImportedLrcFile | null>;
  deleteImported(id: string): Promise<ImportedLrcDeleteResult>;
}

export class LocalLrcProvider implements LyricsProvider {
  readonly id = "local-lrc";
  private entries: LocalLrcEntry[];

  constructor(
    entries: readonly LocalLrcEntry[] = [],
    private readonly persistence?: LocalLrcPersistence,
  ) {
    this.entries = entries.map((entry) => ({ ...entry }));
  }

  setEntries(entries: readonly LocalLrcEntry[]): void {
    this.entries = entries.map((entry) => ({ ...entry }));
  }

  addEntry(entry: LocalLrcEntry): void {
    // Parse before accepting the import so invalid files fail at the boundary.
    parseLrcLyrics(entry.contents, entry.fileName);
    const existingIndex = this.entries.findIndex(
      (candidate) => candidate.id === entry.id,
    );
    if (existingIndex >= 0) {
      this.entries = this.entries.map((candidate, index) =>
        index === existingIndex ? { ...entry } : candidate,
      );
    } else {
      this.entries = [...this.entries, { ...entry }];
    }
  }

  removeEntry(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  listEntries(): ReadonlyArray<Omit<LocalLrcEntry, "contents">> {
    return this.entries.map((entry) => ({
      id: entry.id,
      fileName: entry.fileName,
      spotifyTrackId: entry.spotifyTrackId,
      isrc: entry.isrc,
      title: entry.title,
      artist: entry.artist,
      album: entry.album,
      durationMs: entry.durationMs,
      importedAt: entry.importedAt,
    }));
  }

  async findLyrics(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null> {
    throwIfAborted(signal);
    const match = findBestLocalEntry(this.entries, track);

    if (match) {
      return parseLrcLyrics(match.contents, match.fileName);
    }
    if (!this.persistence) {
      return null;
    }

    const persisted = await this.persistence.matchImported(track);
    throwIfAborted(signal);
    if (!persisted) {
      return null;
    }
    const entry = persistedFileToEntry(persisted);
    this.addEntry(entry);
    return parseLrcLyrics(entry.contents, entry.fileName);
  }

  async reloadPersistedEntries(
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<Omit<LocalLrcEntry, "contents">>> {
    if (!this.persistence) {
      return this.listEntries();
    }

    throwIfAborted(signal);
    const records = await this.persistence.listImported();
    const entries: LocalLrcEntry[] = [];
    for (const record of records) {
      throwIfAborted(signal);
      const file = await this.persistence.readImported(record.id);
      if (file) {
        entries.push(persistedFileToEntry(file));
      }
    }
    this.setEntries(entries);
    return this.listEntries();
  }

  async deletePersistedEntry(
    id: string,
  ): Promise<ImportedLrcDeleteResult> {
    if (!this.persistence) {
      this.removeEntry(id);
      return { deleted: false };
    }

    const result = await this.persistence.deleteImported(id);
    if (result.deleted) {
      this.removeEntry(id);
    }
    return result;
  }
}

export interface LicensedLyricsAdapter {
  id: string;
  displayName: string;
  enabled: boolean;
  lookup(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null>;
}

export class LicensedLyricsProvider implements LyricsProvider {
  readonly id: string;

  constructor(private readonly adapter: LicensedLyricsAdapter) {
    this.id = adapter.id;
  }

  async findLyrics(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null> {
    throwIfAborted(signal);
    if (!this.adapter.enabled) {
      return null;
    }

    try {
      return await this.adapter.lookup(track, signal);
    } catch (cause) {
      if (signal?.aborted) {
        throwIfAborted(signal);
      }
      if (isAbortError(cause)) {
        throw cause;
      }
      throw new LyricsProviderError({
        code: "network",
        providerId: this.id,
        message: `${this.adapter.displayName} could not retrieve lyrics.`,
        cause,
      });
    }
  }
}

export interface AuthorizedLyricsSource {
  id: string;
  baseUrl: string;
  searchUrlTemplate: string;
  resultLinkSelector: string;
  lyricsSelector: string;
  titleSelector?: string;
  artistSelector?: string;
  requestsPerMinute: number;
  userAgent: string;
  enabled?: boolean;
  /** Must be an explicit user confirmation; undefined and false are denied. */
  permissionConfirmed?: boolean;
}

export interface AuthorizedSourceTransport {
  /**
   * The main-process/network implementation must evaluate robots.txt for the
   * exact URL and user agent. Returning false is a hard stop.
   */
  isAllowedByRobots(
    url: string,
    userAgent: string,
    signal?: AbortSignal,
  ): Promise<boolean>;
  getText(
    url: string,
    options: { userAgent: string; signal?: AbortSignal },
  ): Promise<string>;
}

export type AuthorizedTransportProblemCode =
  | "network"
  | "rate-limited"
  | "rejected";

/**
 * Transports must use this error for failures whose retry safety is known.
 * Unknown errors are deliberately not retried.
 */
export class AuthorizedSourceTransportError extends Error {
  readonly code: AuthorizedTransportProblemCode;
  readonly retryAfterMs: number | null;
  override readonly cause?: unknown;

  constructor(options: {
    code: AuthorizedTransportProblemCode;
    message: string;
    retryAfterMs?: number | null;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "AuthorizedSourceTransportError";
    this.code = options.code;
    this.retryAfterMs =
      options.retryAfterMs !== undefined &&
      options.retryAfterMs !== null &&
      Number.isFinite(options.retryAfterMs) &&
      options.retryAfterMs >= 0
        ? Math.round(options.retryAfterMs)
        : null;
    this.cause = options.cause;
  }
}

export const AUTHORIZED_SOURCE_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maximumDelayMs: 30_000,
});

export class AuthorizedScraperProvider implements LyricsProvider {
  readonly id: string;
  private readonly gate: RequestGate;
  private readonly lookupQueue = new SerialTaskQueue();

  constructor(
    private readonly source: AuthorizedLyricsSource,
    private readonly transport: AuthorizedSourceTransport,
  ) {
    validateAuthorizedSource(source);
    this.id = `authorized:${source.id}`;
    this.gate = new RequestGate(source.requestsPerMinute);
  }

  async findLyrics(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null> {
    throwIfAborted(signal);
    if (!this.source.enabled) {
      return null;
    }
    if (this.source.permissionConfirmed !== true) {
      throw new LyricsProviderError({
        code: "permission-required",
        providerId: this.id,
        message:
          "This source is disabled until the user confirms they own it or have permission to scrape it.",
        recoverable: false,
      });
    }

    return await this.lookupQueue.run(
      () => this.findLyricsSerial(track, signal),
      signal,
    );
  }

  private async findLyricsSerial(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null> {
    throwIfAborted(signal);

    const searchUrl = buildSearchUrl(this.source, track);
    await this.assertRobotsPermission(searchUrl, signal);
    const searchHtml = await this.runTransportRequest(
      () =>
        this.transport.getText(searchUrl, {
          userAgent: this.source.userAgent,
          signal,
        }),
      signal,
    );
    const searchDocument = parseHtml(searchHtml, this.id);
    const resultLink = searchDocument.querySelector<HTMLAnchorElement>(
      this.source.resultLinkSelector,
    );
    const href = resultLink?.getAttribute("href");
    if (!href) {
      return null;
    }

    const resultUrl = constrainToSource(
      new URL(href, this.source.baseUrl),
      new URL(this.source.baseUrl),
      this.id,
    ).toString();
    await this.assertRobotsPermission(resultUrl, signal);
    const lyricsHtml = await this.runTransportRequest(
      () =>
        this.transport.getText(resultUrl, {
          userAgent: this.source.userAgent,
          signal,
        }),
      signal,
    );
    const lyricsDocument = parseHtml(lyricsHtml, this.id);
    if (!pageIdentityMatches(lyricsDocument, this.source, track)) {
      return null;
    }

    const lyricsElement = lyricsDocument.querySelector(
      this.source.lyricsSelector,
    );
    const text = lyricsElement?.textContent?.trim();
    if (!text) {
      return null;
    }

    const result = /\[(?:(?:\d{1,2}):)?\d{1,3}:[0-5]?\d/.test(text)
      ? parseLrcLyrics(text, this.source.id)
      : ({
          kind: "plain",
          source: this.source.id,
          text,
        } satisfies LyricsResult);
    return result;
  }

  private async assertRobotsPermission(
    url: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const allowed = await this.runTransportRequest(
      () =>
        this.transport.isAllowedByRobots(
          url,
          this.source.userAgent,
          signal,
        ),
      signal,
    );
    if (!allowed) {
      throw new LyricsProviderError({
        code: "robots-denied",
        providerId: this.id,
        message: "The configured source disallows this request in robots.txt.",
        recoverable: false,
      });
    }
  }

  private async runTransportRequest<T>(
    request: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { maxAttempts, initialDelayMs, maximumDelayMs } =
      AUTHORIZED_SOURCE_RETRY_POLICY;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await this.gate.run(request, signal);
      } catch (cause) {
        if (signal?.aborted) {
          throwIfAborted(signal);
        }
        if (isAbortError(cause)) {
          throw cause;
        }

        const transient = getTransientTransportFailure(cause);
        const finalAttempt = attempt + 1 >= maxAttempts;
        if (!transient || finalAttempt) {
          throw toLyricsTransportError(cause, this.id);
        }

        const exponentialDelay = Math.min(
          maximumDelayMs,
          initialDelayMs * 2 ** attempt,
        );
        if (
          transient.retryAfterMs !== null &&
          transient.retryAfterMs > maximumDelayMs
        ) {
          throw toLyricsTransportError(cause, this.id);
        }
        await abortableDelay(
          Math.max(exponentialDelay, transient.retryAfterMs ?? 0),
          signal,
        );
      }
    }

    throw new LyricsProviderError({
      code: "unknown",
      providerId: this.id,
      message: "The authorized lyrics source request did not complete.",
    });
  }
}

export class LyricsProviderChain implements LyricsProvider {
  readonly id = "provider-chain";

  constructor(
    private readonly providers: readonly LyricsProvider[],
    private readonly onProviderError?: (
      provider: LyricsProvider,
      error: unknown,
    ) => void,
  ) {}

  async findLyrics(
    track: TrackIdentity,
    signal?: AbortSignal,
  ): Promise<LyricsResult | null> {
    throwIfAborted(signal);
    for (const provider of this.providers) {
      try {
        const result = await provider.findLyrics(track, signal);
        if (result) {
          return result;
        }
      } catch (error) {
        if (signal?.aborted) {
          throwIfAborted(signal);
        }
        if (isAbortError(error)) {
          throw error;
        }
        this.onProviderError?.(provider, error);
      }
    }
    return null;
  }
}

export { normalizeLyricsIdentity };

function scoreLocalMatch(
  entry: LocalLrcEntry,
  track: TrackIdentity,
): number {
  return scoreLyricsIdentity(entry, track);
}

function findBestLocalEntry(
  entries: readonly LocalLrcEntry[],
  track: TrackIdentity,
): LocalLrcEntry | null {
  return (
    entries
      .map((entry) => ({
        entry,
        score: scoreLocalMatch(entry, track),
      }))
      .filter((candidate) => candidate.score >= 600)
      .sort((left, right) => right.score - left.score)[0]?.entry ?? null
  );
}

function persistedFileToEntry(
  file: ImportedLrcFile,
): LocalLrcEntry {
  return {
    id: file.id,
    fileName: file.fileName,
    contents: file.content,
    spotifyTrackId: file.spotifyTrackId,
    isrc: file.isrc,
    title: file.title,
    artist: file.artist,
    album: file.album,
    durationMs: file.durationMs,
    importedAt: Date.parse(file.importedAt),
  };
}

function validateAuthorizedSource(source: AuthorizedLyricsSource): void {
  let baseUrl: URL;
  try {
    baseUrl = new URL(source.baseUrl);
  } catch (cause) {
    throw new LyricsProviderError({
      code: "invalid-source",
      providerId: `authorized:${source.id}`,
      message: "The authorized lyrics source has an invalid base URL.",
      recoverable: false,
      cause,
    });
  }

  if (baseUrl.protocol !== "https:") {
    throw new LyricsProviderError({
      code: "invalid-source",
      providerId: `authorized:${source.id}`,
      message: "Authorized lyrics sources must use HTTPS.",
      recoverable: false,
    });
  }
  if (
    !Number.isInteger(source.requestsPerMinute) ||
    source.requestsPerMinute < 1 ||
    source.requestsPerMinute > 60
  ) {
    throw new LyricsProviderError({
      code: "invalid-source",
      providerId: `authorized:${source.id}`,
      message: "Requests per minute must be an integer between 1 and 60.",
      recoverable: false,
    });
  }
  if (!source.userAgent.trim() || !source.lyricsSelector.trim()) {
    throw new LyricsProviderError({
      code: "invalid-source",
      providerId: `authorized:${source.id}`,
      message: "The source requires a user agent and lyrics selector.",
      recoverable: false,
    });
  }
}

function buildSearchUrl(
  source: AuthorizedLyricsSource,
  track: TrackIdentity,
): string {
  const replacements: Record<string, string> = {
    title: track.title,
    artist: track.artist,
    album: track.album ?? "",
    isrc: track.isrc ?? "",
  };
  const interpolated = source.searchUrlTemplate.replace(
    /\{(title|artist|album|isrc)\}/g,
    (_match, key: string) => encodeURIComponent(replacements[key] ?? ""),
  );
  return constrainToSource(
    new URL(interpolated, source.baseUrl),
    new URL(source.baseUrl),
    `authorized:${source.id}`,
  ).toString();
}

function constrainToSource(
  url: URL,
  baseUrl: URL,
  providerId: string,
): URL {
  if (url.protocol !== "https:" || url.origin !== baseUrl.origin) {
    throw new LyricsProviderError({
      code: "invalid-source",
      providerId,
      message: "The configured selector tried to leave the authorized source.",
      recoverable: false,
    });
  }
  url.username = "";
  url.password = "";
  return url;
}

function parseHtml(html: string, providerId: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new LyricsProviderError({
      code: "parse",
      providerId,
      message: "HTML parsing is unavailable in this renderer.",
    });
  }
  return new DOMParser().parseFromString(html, "text/html");
}

function pageIdentityMatches(
  document: Document,
  source: AuthorizedLyricsSource,
  track: TrackIdentity,
): boolean {
  if (source.titleSelector) {
    const pageTitle = document.querySelector(source.titleSelector)?.textContent;
    if (
      pageTitle &&
      normalizeLyricsIdentity(pageTitle) !==
        normalizeLyricsIdentity(track.title)
    ) {
      return false;
    }
  }
  if (source.artistSelector) {
    const pageArtist = document.querySelector(
      source.artistSelector,
    )?.textContent;
    if (
      pageArtist &&
      normalizeLyricsIdentity(pageArtist) !==
        normalizeLyricsIdentity(track.artist)
    ) {
      return false;
    }
  }
  return true;
}

class RequestGate {
  private readonly minimumIntervalMs: number;
  private nextAvailableAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(requestsPerMinute: number) {
    this.minimumIntervalMs = Math.ceil(60_000 / requestsPerMinute);
  }

  run<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const task = this.queue.then(async () => {
      throwIfAborted(signal);
      const waitMs = Math.max(0, this.nextAvailableAt - Date.now());
      if (waitMs > 0) {
        await abortableDelay(waitMs, signal);
      }
      throwIfAborted(signal);
      this.nextAvailableAt = Date.now() + this.minimumIntervalMs;
      return request();
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return raceWithAbort(task, signal);
  }
}

class SerialTaskQueue {
  private queue: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const result = this.queue.then(async () => {
      throwIfAborted(signal);
      return task();
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return raceWithAbort(result, signal);
  }
}

function getTransientTransportFailure(
  cause: unknown,
): { code: "network" | "rate-limited"; retryAfterMs: number | null } | null {
  if (cause instanceof AuthorizedSourceTransportError) {
    if (cause.code === "network" || cause.code === "rate-limited") {
      return {
        code: cause.code,
        retryAfterMs: cause.retryAfterMs,
      };
    }
    return null;
  }
  if (
    cause instanceof LyricsProviderError &&
    (cause.code === "network" || cause.code === "rate-limited")
  ) {
    return {
      code: cause.code,
      retryAfterMs: null,
    };
  }
  return null;
}

function toLyricsTransportError(
  cause: unknown,
  providerId: string,
): LyricsProviderError {
  if (cause instanceof LyricsProviderError) {
    return cause;
  }
  if (cause instanceof AuthorizedSourceTransportError) {
    const code =
      cause.code === "network" || cause.code === "rate-limited"
        ? cause.code
        : "unknown";
    return new LyricsProviderError({
      code,
      providerId,
      message:
        code === "rate-limited"
          ? "The authorized lyrics source is rate limiting requests."
          : code === "network"
            ? "The authorized lyrics source could not be reached."
            : "The authorized lyrics source rejected the request.",
      cause,
    });
  }
  return new LyricsProviderError({
    code: "unknown",
    providerId,
    message: "The authorized lyrics source request failed.",
    cause,
  });
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError"
    )
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function abortableDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) {
    return operation;
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
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
