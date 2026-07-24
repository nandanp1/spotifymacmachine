import { describe, expect, it } from "vitest";

import {
  cacheClearResultSchema,
  cacheInfoSchema,
  recoverySignalSchema,
  recoveryStateSchema,
} from "../../src/shared/schemas";

const readyState = {
  suspended: false,
  screenLocked: false,
  online: true,
  observedAt: 1_753_374_400_000,
};

describe("recovery and cache schemas", () => {
  it("accepts a strict recovery snapshot", () => {
    expect(recoveryStateSchema.parse(readyState)).toEqual(readyState);
  });

  it.each([
    {
      kind: "power",
      event: "suspend",
      state: { ...readyState, suspended: true },
    },
    {
      kind: "power",
      event: "unlock-screen",
      state: readyState,
    },
    {
      kind: "network",
      online: false,
      state: { ...readyState, online: false },
    },
  ])("accepts a typed recovery signal: %o", (signal) => {
    expect(recoverySignalSchema.parse(signal)).toEqual(signal);
  });

  it.each([
    { ...readyState, observedAt: 0 },
    { ...readyState, online: "yes" },
    { ...readyState, accessToken: "must-not-cross-this-boundary" },
  ])("rejects an invalid recovery state: %o", (state) => {
    expect(recoveryStateSchema.safeParse(state).success).toBe(false);
  });

  it.each([
    { kind: "power", event: "sleep", state: readyState },
    {
      kind: "power",
      event: "suspend",
      state: { ...readyState, suspended: false },
    },
    { kind: "network", online: true, state: readyState, retry: true },
    { kind: "network", online: false, state: readyState },
    { kind: "unknown", state: readyState },
  ])("rejects an invalid recovery signal: %o", (signal) => {
    expect(recoverySignalSchema.safeParse(signal).success).toBe(false);
  });

  it("accepts only a safe nonnegative integer cache size", () => {
    expect(cacheInfoSchema.parse({ sizeBytes: 12_345 })).toEqual({
      sizeBytes: 12_345,
    });

    expect(cacheInfoSchema.safeParse({ sizeBytes: -1 }).success).toBe(false);
    expect(cacheInfoSchema.safeParse({ sizeBytes: 1.5 }).success).toBe(false);
    expect(
      cacheInfoSchema.safeParse({
        sizeBytes: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      cacheInfoSchema.safeParse({ sizeBytes: 0, path: "/private/cache" })
        .success,
    ).toBe(false);

    expect(cacheClearResultSchema.parse({ cleared: true })).toEqual({
      cleared: true,
    });
    expect(
      cacheClearResultSchema.safeParse({ cleared: true, keychain: "kept" })
        .success,
    ).toBe(false);
  });
});
