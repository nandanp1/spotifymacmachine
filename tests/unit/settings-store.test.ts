import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SettingsStore } from "../../src/main/secure-store";
import { defaultSettings } from "../../src/shared/schemas";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SettingsStore migrations", () => {
  it("adds the disabled LRCLIB default without discarding older preferences", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "aura-settings-migration-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "settings.json");
    const legacySettings: Record<string, unknown> = {
      ...defaultSettings,
      deviceName: "Studio Mac",
      motionIntensity: 0.25,
    };
    delete legacySettings.experimentalLrclibEnabled;
    await writeFile(filePath, JSON.stringify(legacySettings), "utf8");

    const store = new SettingsStore(filePath);

    await expect(store.get()).resolves.toMatchObject({
      deviceName: "Studio Mac",
      motionIntensity: 0.25,
      experimentalLrclibEnabled: false,
    });
  });

  it("persists an explicit opt-in through the validated settings document", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "aura-settings-opt-in-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "settings.json");
    const store = new SettingsStore(filePath);

    await expect(
      store.update({ experimentalLrclibEnabled: true }),
    ).resolves.toMatchObject({ experimentalLrclibEnabled: true });

    const persisted: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted).toMatchObject({
      experimentalLrclibEnabled: true,
    });
    await expect(new SettingsStore(filePath).get()).resolves.toMatchObject({
      experimentalLrclibEnabled: true,
    });
  });
});
