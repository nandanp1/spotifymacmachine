// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";

beforeEach(() => {
  vi.resetModules();
  document
    .querySelectorAll(`script[src="${SDK_URL}"]`)
    .forEach((script) => script.remove());
  delete window.Spotify;
  delete window.onSpotifyWebPlaybackSDKReady;
});

afterEach(() => {
  document
    .querySelectorAll(`script[src="${SDK_URL}"]`)
    .forEach((script) => script.remove());
  delete window.Spotify;
  delete window.onSpotifyWebPlaybackSDKReady;
});

describe("Spotify SDK loader retries", () => {
  it("removes a failed script and restores the ready callback before retrying", async () => {
    const previousReady = vi.fn();
    window.onSpotifyWebPlaybackSDKReady = previousReady;
    const { loadSpotifyPlaybackSdk } = await import(
      "../../src/renderer/features/player/spotify-playback-service"
    );

    const firstLoad = loadSpotifyPlaybackSdk(SDK_URL, 1_000);
    const firstScript = requireSdkScript();
    const firstRejection = expect(firstLoad).rejects.toThrow(
      "Spotify playback SDK failed to load",
    );
    firstScript.dispatchEvent(new Event("error"));
    await firstRejection;

    expect(document.contains(firstScript)).toBe(false);
    expect(window.onSpotifyWebPlaybackSDKReady).toBe(previousReady);

    const secondLoad = loadSpotifyPlaybackSdk(SDK_URL, 1_000);
    const secondScript = requireSdkScript();
    expect(secondScript).not.toBe(firstScript);

    const sdk = { Player: class Player {} };
    Object.defineProperty(window, "Spotify", {
      configurable: true,
      value: sdk,
    });
    window.onSpotifyWebPlaybackSDKReady?.();

    await expect(secondLoad).resolves.toBe(sdk);
    expect(previousReady).toHaveBeenCalledOnce();
    expect(window.onSpotifyWebPlaybackSDKReady).toBe(previousReady);
    expect(document.contains(secondScript)).toBe(true);
  });
});

function requireSdkScript(): HTMLScriptElement {
  const script = document.querySelector<HTMLScriptElement>(
    `script[src="${SDK_URL}"]`,
  );
  if (!script) {
    throw new Error("Expected Spotify SDK script.");
  }
  return script;
}
