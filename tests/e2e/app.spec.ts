import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, _electron as electron, type ElectronApplication } from "@playwright/test";

let application: ElectronApplication;
let testUserData: string;

test.beforeAll(async () => {
  testUserData = await mkdtemp(path.join(tmpdir(), "aura-player-e2e-"));
  application = await electron.launch({
    args: [".", `--user-data-dir=${testUserData}`],
    cwd: process.cwd(),
    env: {
      ...process.env,
      AURA_E2E: "1",
      NODE_ENV: "test",
    },
  });
});

test.afterAll(async () => {
  await application?.close();
  if (testUserData) {
    await rm(testUserData, { recursive: true, force: true });
  }
});

test("launches into an honest, functional Aura preview", async () => {
  const window = await application.firstWindow();

  await expect(window).toHaveTitle("Aura Player");
  await expect
    .poll(() => window.evaluate(() => typeof globalThis.window.aura))
    .toBe("object");
  await expect(
    window.getByRole("heading", { name: "Afterimage", exact: true }),
  ).toBeVisible();
  await expect(window.getByText("Local design preview")).toBeVisible();
  await expect(window.getByText("Not a Spotify device")).toBeVisible();

  const pause = window.getByRole("button", { name: "Pause" });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(
    window.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
});

test("opens secondary surfaces and honors keyboard lyric controls", async () => {
  const window = await application.firstWindow();

  await window.getByRole("button", { name: "Open library" }).click();
  await expect(
    window.getByRole("dialog", { name: "Find the next room" }),
  ).toBeVisible();
  await expect(window.getByText("Local preview collection")).toBeVisible();
  await window.getByRole("searchbox", { name: "Search tracks" }).fill("Mercury");
  await window
    .getByRole("button", { name: /Play Slow Mercury by Oren Field/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Slow Mercury", exact: true }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Open library" }).click();
  await window.keyboard.press("Escape");
  await expect(
    window.getByRole("dialog", { name: "Find the next room" }),
  ).toBeHidden();

  await window.keyboard.press("l");
  await expect(window.getByLabel("Lyrics hidden")).toBeVisible();
  await window.keyboard.press("l");
  await expect(window.getByText("Synced words")).toBeVisible();
});

test("persists visual preferences and validates the fullscreen bridge", async () => {
  const window = await application.firstWindow();

  await window.getByRole("button", { name: "Open settings" }).click();
  await expect(
    window.getByRole("dialog", { name: "Tune the room" }),
  ).toBeVisible();
  await expect(window.getByText(/cached|cache size/i)).toBeVisible();

  await window.getByRole("button", { name: "Minimal" }).click();
  await expect(
    window.getByRole("button", { name: "Minimal" }),
  ).toHaveAttribute("aria-pressed", "true");

  const defaultLyrics = window.getByRole("checkbox", {
    name: "Show lyrics by default",
  });
  if (await defaultLyrics.isChecked()) {
    await defaultLyrics.click();
  }
  await expect(defaultLyrics).not.toBeChecked();
  await expect
    .poll(() =>
      window.evaluate(() =>
        globalThis.window.aura.settings
          .get()
          .then((value) => value.showLyricsByDefault),
      ),
    )
    .toBe(false);

  await window.keyboard.press("Escape");
  await window.reload();
  await expect(window.getByLabel("Lyrics hidden")).toBeVisible();

  await expect(
    window.evaluate(() => globalThis.window.aura.window.toggleFullscreen()),
  ).resolves.toBe(true);
  await expect(
    window.evaluate(() =>
      globalThis.window.aura.window.setFullscreen(false),
    ),
  ).resolves.toBe(false);
});
