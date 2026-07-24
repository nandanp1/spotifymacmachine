import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { MAX_LRC_FILE_BYTES } from "../shared/constants";
import { scoreLyricsIdentity } from "../shared/lyrics";
import {
  importedLrcDeleteResultSchema,
  importedLrcFileSchema,
  importedLrcIdSchema,
  importedLrcRecordSchema,
  importedLrcRecordsSchema,
  lyricsTrackIdentitySchema,
} from "../shared/schemas";
import type {
  ImportedLrcDeleteResult,
  ImportedLrcFile,
  ImportedLrcRecord,
  LyricsTrackIdentity,
} from "../shared/types";

const MAX_METADATA_FILE_BYTES = 16 * 1_024;
const STORED_ID_PATTERN = /^[a-f0-9]{64}$/;
const LRC_METADATA_TAG =
  /^\[(ti|ar|al|isrc|spotifyid|spotify_track_id):([^\]\r\n]*)\]\s*$/gim;

export interface SaveImportedLrcInput {
  fileName: string;
  content: string;
  track?: LyricsTrackIdentity;
}

/**
 * User-imported lyrics are kept under one canonical user-data directory.
 * Metadata and text writes are atomically renamed, and every disk record is
 * parsed before it crosses back into the renderer.
 */
export class ImportedLyricsStore {
  private operation: Promise<void> = Promise.resolve();

  constructor(
    private readonly directoryPath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  save(input: SaveImportedLrcInput): Promise<ImportedLrcFile> {
    return this.enqueue(async () => {
      const directory = await this.ensureDirectory();
      const content = validateLrcContent(input.content);
      const sizeBytes = Buffer.byteLength(content, "utf8");
      const id = createHash("sha256").update(content, "utf8").digest("hex");
      const track = input.track
        ? lyricsTrackIdentitySchema.parse(input.track)
        : undefined;
      const existing = await this.readRecordIfPresent(directory, id);
      const extracted = extractLrcMetadata(content);
      const identity = track
        ? toRecordIdentity(track)
        : mergeRecordIdentity(existing, extracted);
      const record = importedLrcRecordSchema.parse({
        id,
        fileName: input.fileName,
        sizeBytes,
        importedAt: this.now().toISOString(),
        ...identity,
      });

      await atomicWrite(
        this.recordPath(directory, id, "lrc"),
        content,
      );
      await atomicWrite(
        this.recordPath(directory, id, "json"),
        JSON.stringify(record, null, 2),
      );

      return importedLrcFileSchema.parse({
        ...record,
        content,
      });
    });
  }

  list(): Promise<ImportedLrcRecord[]> {
    return this.enqueue(async () => {
      const directory = await this.ensureDirectory();
      return this.listFromDirectory(directory);
    });
  }

  read(id: string): Promise<ImportedLrcFile | null> {
    return this.enqueue(async () => {
      const validatedId = importedLrcIdSchema.parse(id);
      const directory = await this.ensureDirectory();
      return this.readFromDirectory(directory, validatedId);
    });
  }

  match(
    rawTrack: LyricsTrackIdentity,
  ): Promise<ImportedLrcFile | null> {
    return this.enqueue(async () => {
      const track = lyricsTrackIdentitySchema.parse(rawTrack);
      const directory = await this.ensureDirectory();
      const records = await this.listFromDirectory(directory);
      const match = records
        .map((record) => ({
          record,
          score: scoreLyricsIdentity(record, track),
        }))
        .filter((candidate) => candidate.score >= 600)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.record.importedAt.localeCompare(
              left.record.importedAt,
            ) ||
            left.record.id.localeCompare(right.record.id),
        )[0];

      return match
        ? this.readFromDirectory(directory, match.record.id)
        : null;
    });
  }

  async delete(id: string): Promise<ImportedLrcDeleteResult> {
    const validatedId = importedLrcIdSchema.parse(id);
    return this.enqueue(async () => {
      const directory = await this.ensureDirectory();
      const nonce = randomUUID();
      const contentPath = this.recordPath(directory, validatedId, "lrc");
      const metadataPath = this.recordPath(directory, validatedId, "json");
      const contentTombstone = this.tombstonePath(
        directory,
        validatedId,
        nonce,
        "lrc",
      );
      const metadataTombstone = this.tombstonePath(
        directory,
        validatedId,
        nonce,
        "json",
      );

      const contentMoved = await renameIfPresent(
        contentPath,
        contentTombstone,
      );
      let metadataMoved = false;
      try {
        metadataMoved = await renameIfPresent(
          metadataPath,
          metadataTombstone,
        );
      } catch (error) {
        if (contentMoved) {
          await rename(contentTombstone, contentPath);
        }
        throw error;
      }

      await Promise.all([
        contentMoved ? unlinkIfPresent(contentTombstone) : undefined,
        metadataMoved ? unlinkIfPresent(metadataTombstone) : undefined,
      ]);
      return importedLrcDeleteResultSchema.parse({
        deleted: contentMoved || metadataMoved,
      });
    });
  }

  private async listFromDirectory(
    directory: string,
  ): Promise<ImportedLrcRecord[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const records = new Map<string, ImportedLrcRecord>();

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = /^([a-f0-9]{64})\.json$/.exec(entry.name);
      if (!match?.[1]) {
        continue;
      }
      const record = await this.readRecordIfPresent(directory, match[1]);
      if (record) {
        records.set(record.id, record);
      }
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = /^([a-f0-9]{64})\.lrc$/.exec(entry.name);
      const id = match?.[1];
      if (!id || records.has(id)) {
        continue;
      }
      const migrated = await this.migrateLegacyRecord(directory, id);
      if (migrated) {
        records.set(id, migrated);
      }
    }

    return importedLrcRecordsSchema.parse(
      [...records.values()].sort(
        (left, right) =>
          right.importedAt.localeCompare(left.importedAt) ||
          left.id.localeCompare(right.id),
      ),
    );
  }

  private async readFromDirectory(
    directory: string,
    id: string,
  ): Promise<ImportedLrcFile | null> {
    const record =
      (await this.readRecordIfPresent(directory, id)) ??
      (await this.migrateLegacyRecord(directory, id));
    if (!record) {
      return null;
    }

    const content = await readStoredContent(
      this.recordPath(directory, id, "lrc"),
    );
    return importedLrcFileSchema.parse({
      ...record,
      content,
    });
  }

  private async readRecordIfPresent(
    directory: string,
    id: string,
  ): Promise<ImportedLrcRecord | null> {
    const metadataPath = this.recordPath(directory, id, "json");
    try {
      const metadataStat = await stat(metadataPath);
      if (
        !metadataStat.isFile() ||
        metadataStat.size > MAX_METADATA_FILE_BYTES
      ) {
        return null;
      }
      const serialized = await readFile(metadataPath, "utf8");
      const parsed: unknown = JSON.parse(serialized);
      const result = importedLrcRecordSchema.safeParse(parsed);
      return result.success && result.data.id === id ? result.data : null;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      return null;
    }
  }

  private async migrateLegacyRecord(
    directory: string,
    id: string,
  ): Promise<ImportedLrcRecord | null> {
    const contentPath = this.recordPath(directory, id, "lrc");
    try {
      const [content, contentStat] = await Promise.all([
        readStoredContent(contentPath),
        stat(contentPath),
      ]);
      if (!contentStat.isFile()) {
        return null;
      }
      const record = importedLrcRecordSchema.parse({
        id,
        fileName: `Imported lyrics ${id.slice(0, 12)}.lrc`,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        importedAt: contentStat.mtime.toISOString(),
        ...extractLrcMetadata(content),
      });
      await atomicWrite(
        this.recordPath(directory, id, "json"),
        JSON.stringify(record, null, 2),
      );
      return record;
    } catch {
      return null;
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async ensureDirectory(): Promise<string> {
    await mkdir(this.directoryPath, { recursive: true, mode: 0o700 });
    return realpath(this.directoryPath);
  }

  private recordPath(
    canonicalDirectory: string,
    id: string,
    extension: "json" | "lrc",
  ): string {
    const validatedId = importedLrcIdSchema.parse(id);
    return exactChildPath(
      canonicalDirectory,
      `${validatedId}.${extension}`,
    );
  }

  private tombstonePath(
    canonicalDirectory: string,
    id: string,
    nonce: string,
    extension: "json" | "lrc",
  ): string {
    if (!STORED_ID_PATTERN.test(id)) {
      throw new Error("Invalid imported lyrics ID.");
    }
    return exactChildPath(
      canonicalDirectory,
      `.${id}.${nonce}.${extension}.deleted`,
    );
  }
}

function validateLrcContent(value: string): string {
  const content = value.replace(/^\uFEFF/, "");
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > MAX_LRC_FILE_BYTES) {
    throw new Error("The selected lyrics file is too large.");
  }
  if (content.includes("\u0000")) {
    throw new Error("The selected lyrics file contains invalid text.");
  }
  return content;
}

function toRecordIdentity(
  track: LyricsTrackIdentity,
): Omit<
  LyricsTrackIdentity,
  "spotifyTrackId"
> & { spotifyTrackId: string } {
  return { ...track };
}

function mergeRecordIdentity(
  existing: ImportedLrcRecord | null,
  extracted: Partial<ImportedLrcRecord>,
): Partial<ImportedLrcRecord> {
  const source = {
    ...extracted,
    ...(existing ?? {}),
  };
  return {
    ...(source.spotifyTrackId
      ? { spotifyTrackId: source.spotifyTrackId }
      : {}),
    ...(source.isrc ? { isrc: source.isrc } : {}),
    ...(source.title ? { title: source.title } : {}),
    ...(source.artist ? { artist: source.artist } : {}),
    ...(source.album ? { album: source.album } : {}),
    ...(source.durationMs ? { durationMs: source.durationMs } : {}),
  };
}

function extractLrcMetadata(
  content: string,
): Partial<ImportedLrcRecord> {
  const values = new Map<string, string>();
  LRC_METADATA_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LRC_METADATA_TAG.exec(content)) !== null) {
    const key = match[1]?.toLowerCase();
    const value = sanitizeMetadataValue(match[2] ?? "");
    if (key && value && !values.has(key)) {
      values.set(key, value);
    }
  }

  const isrc = values.get("isrc");
  const spotifyTrackId =
    values.get("spotifyid") ?? values.get("spotify_track_id");
  return {
    ...(spotifyTrackId ? { spotifyTrackId } : {}),
    ...(isrc && /^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/.test(isrc)
      ? { isrc }
      : {}),
    ...(values.get("ti") ? { title: values.get("ti") } : {}),
    ...(values.get("ar") ? { artist: values.get("ar") } : {}),
    ...(values.get("al") ? { album: values.get("al") } : {}),
  };
}

function sanitizeMetadataValue(value: string): string {
  return [...value.normalize("NFC")]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim()
    .slice(0, 300);
}

async function readStoredContent(filePath: string): Promise<string> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size > MAX_LRC_FILE_BYTES) {
    throw new Error("The imported lyrics file is invalid.");
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength > MAX_LRC_FILE_BYTES) {
    throw new Error("The imported lyrics file is too large.");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The imported lyrics file is not valid UTF-8 text.");
  }
  return validateLrcContent(content);
}

async function atomicWrite(
  targetPath: string,
  contents: string,
): Promise<void> {
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } finally {
    await unlinkIfPresent(temporaryPath);
  }
}

function exactChildPath(directory: string, fileName: string): string {
  const resolvedDirectory = path.resolve(directory);
  const target = path.resolve(resolvedDirectory, fileName);
  if (path.dirname(target) !== resolvedDirectory) {
    throw new Error("Imported lyrics path escaped its storage directory.");
  }
  return target;
}

async function renameIfPresent(
  sourcePath: string,
  destinationPath: string,
): Promise<boolean> {
  try {
    await rename(sourcePath, destinationPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function isMissingFileError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
