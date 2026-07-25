import { describe, expect, it } from "vitest";

import {
  appSettingsSchema,
  defaultSettings,
  settingsPatchSchema,
} from "../../src/shared/schemas";

describe("application settings schemas", () => {
  it("keeps the shipped defaults valid", () => {
    expect(appSettingsSchema.parse(defaultSettings)).toEqual(defaultSettings);
    expect(defaultSettings).toMatchObject({
      deviceName: "Aura Player — Mac",
      experimentalLrclibEnabled: false,
      lyricOffsetMs: 0,
      motionIntensity: 0.72,
      visualMode: "aurora",
    });
  });

  it("accepts a bounded partial settings update", () => {
    expect(
      settingsPatchSchema.parse({
        experimentalLrclibEnabled: true,
        lyricOffsetMs: -850,
        motionIntensity: 0,
        textScale: 1.5,
        visualMode: "minimal",
      }),
    ).toEqual({
      experimentalLrclibEnabled: true,
      lyricOffsetMs: -850,
      motionIntensity: 0,
      textScale: 1.5,
      visualMode: "minimal",
    });
  });

  it("keeps the experimental LRCLIB opt-in explicit and boolean-only", () => {
    expect(settingsPatchSchema.parse({})).toEqual({});
    expect(
      settingsPatchSchema.parse({ experimentalLrclibEnabled: false }),
    ).toEqual({ experimentalLrclibEnabled: false });
    expect(
      settingsPatchSchema.parse({ experimentalLrclibEnabled: true }),
    ).toEqual({ experimentalLrclibEnabled: true });
    expect(
      settingsPatchSchema.safeParse({ experimentalLrclibEnabled: "true" })
        .success,
    ).toBe(false);
  });

  it.each([
    { deviceName: "" },
    { lyricOffsetMs: 10_001 },
    { lyricOffsetMs: 0.5 },
    { motionIntensity: -0.01 },
    { backgroundBlur: 1.01 },
    { artworkScale: 0.74 },
    { textScale: 1.51 },
    { visualMode: "spectrum" },
  ])("rejects an invalid settings patch: %o", (patch) => {
    expect(settingsPatchSchema.safeParse(patch).success).toBe(false);
  });

  it("rejects unknown settings instead of silently persisting them", () => {
    expect(
      settingsPatchSchema.safeParse({ accessToken: "must-not-persist" })
        .success,
    ).toBe(false);

    expect(
      appSettingsSchema.safeParse({
        ...defaultSettings,
        experimentalNodeAccess: true,
      }).success,
    ).toBe(false);
  });
});
