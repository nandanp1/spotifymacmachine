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
      lyricOffsetMs: 0,
      motionIntensity: 0.72,
      visualMode: "aurora",
    });
  });

  it("accepts a bounded partial settings update", () => {
    expect(
      settingsPatchSchema.parse({
        lyricOffsetMs: -850,
        motionIntensity: 0,
        textScale: 1.5,
        visualMode: "minimal",
      }),
    ).toEqual({
      lyricOffsetMs: -850,
      motionIntensity: 0,
      textScale: 1.5,
      visualMode: "minimal",
    });
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
