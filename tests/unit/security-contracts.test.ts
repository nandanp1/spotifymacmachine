import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../../src/shared/content-security-policy";
import { SPOTIFY_SCOPES } from "../../src/shared/constants";

describe("renderer content security policy", () => {
  it("uses the main-process header as the single enforced policy", () => {
    const html = readFileSync(
      new URL("../../src/renderer/index.html", import.meta.url),
      "utf8",
    );

    expect(html).not.toContain('http-equiv="Content-Security-Policy"');
    expect(buildContentSecurityPolicy(false)).toContain(
      "frame-src https://sdk.scdn.co",
    );
  });

  it("adds only loopback development connections", () => {
    const production = buildContentSecurityPolicy(false);
    const development = buildContentSecurityPolicy(true);

    expect(production).not.toContain("localhost");
    expect(production).not.toContain("127.0.0.1");
    expect(development).toContain("http://127.0.0.1:*");
    expect(development).toContain("ws://localhost:*");
    expect(development).not.toContain("'unsafe-eval'");
    expect(development).toContain("default-src 'self'");
    expect(development).toContain("object-src 'none'");
    expect(development).toContain("frame-src https://sdk.scdn.co");
  });
});

describe("Spotify authorization scope contract", () => {
  it("requests only scopes consumed by playback, devices, and library", () => {
    expect(SPOTIFY_SCOPES).toEqual([
      "streaming",
      "user-read-email",
      "user-read-private",
      "user-read-playback-state",
      "user-modify-playback-state",
      "playlist-read-private",
      "playlist-read-collaborative",
      "user-library-read",
    ]);
    expect(SPOTIFY_SCOPES).not.toContain("user-read-currently-playing");
  });
});
