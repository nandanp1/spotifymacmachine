import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import keytar from "keytar";

import {
  KEYCHAIN_SERVICE,
  KEYCHAIN_TOKEN_ACCOUNT,
} from "../shared/constants";
import {
  appSettingsSchema,
  defaultSettings,
  settingsPatchSchema,
  spotifyTokenRecordSchema,
} from "../shared/schemas";
import type { AppSettings, SpotifyTokenRecord } from "../shared/types";

export type SecureStoreErrorCode =
  | "keychainUnavailable"
  | "invalidTokenRecord";

export class SecureStoreError extends Error {
  readonly code: SecureStoreErrorCode;

  constructor(code: SecureStoreErrorCode) {
    super(
      code === "keychainUnavailable"
        ? "The macOS Keychain is unavailable."
        : "The saved Spotify session is invalid.",
    );
    this.name = "SecureStoreError";
    this.code = code;
  }
}

interface KeychainAdapter {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * OAuth credentials live only in macOS Keychain. Callers must not cache,
 * serialize, or log values returned by this class.
 */
export class SecureTokenStore {
  constructor(
    private readonly keychain: KeychainAdapter = keytar,
    private readonly service = KEYCHAIN_SERVICE,
    private readonly account = KEYCHAIN_TOKEN_ACCOUNT,
  ) {}

  async get(): Promise<SpotifyTokenRecord | null> {
    let serialized: string | null;

    try {
      serialized = await this.keychain.getPassword(this.service, this.account);
    } catch {
      throw new SecureStoreError("keychainUnavailable");
    }

    if (serialized === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(serialized);
      return spotifyTokenRecordSchema.parse(parsed);
    } catch {
      throw new SecureStoreError("invalidTokenRecord");
    }
  }

  async set(tokens: SpotifyTokenRecord): Promise<void> {
    const validated = spotifyTokenRecordSchema.parse(tokens);

    try {
      await this.keychain.setPassword(
        this.service,
        this.account,
        JSON.stringify(validated),
      );
    } catch {
      throw new SecureStoreError("keychainUnavailable");
    }
  }

  async delete(): Promise<void> {
    try {
      await this.keychain.deletePassword(this.service, this.account);
    } catch {
      throw new SecureStoreError("keychainUnavailable");
    }
  }
}

/**
 * Non-sensitive preferences are stored as a small, validated JSON document.
 * Writes are serialized and atomically renamed to avoid partial settings files.
 */
export class SettingsStore {
  private cached: AppSettings | null = null;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(): Promise<AppSettings> {
    await this.operation.catch(() => undefined);

    if (this.cached !== null) {
      return { ...this.cached };
    }

    this.cached = await this.readFromDisk();
    return { ...this.cached };
  }

  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const validatedPatch = settingsPatchSchema.parse(patch);
    const updateOperation = this.operation.then(async () => {
      const current = this.cached ?? (await this.readFromDisk());
      const next = appSettingsSchema.parse({
        ...current,
        ...validatedPatch,
      });

      await this.writeToDisk(next);
      this.cached = next;
      return { ...next };
    });

    this.operation = updateOperation.catch(() => undefined);
    return updateOperation;
  }

  private async readFromDisk(): Promise<AppSettings> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(contents);
      const result = appSettingsSchema.safeParse(parsed);

      return result.success ? result.data : { ...defaultSettings };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code !== "ENOENT"
      ) {
        // Preferences contain no credentials. A malformed or inaccessible file
        // falls back safely without surfacing its contents in an error message.
      }
      return { ...defaultSettings };
    }
  }

  private async writeToDisk(settings: AppSettings): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;

    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
