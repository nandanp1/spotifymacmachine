import { z } from "zod";

import { DEFAULT_SETTINGS, MAX_LRC_FILE_BYTES } from "./constants";
import type { AppSettings } from "./types";

export const visualModeSchema = z.enum([
  "aurora",
  "bloom",
  "orbit",
  "glass",
  "ink",
  "minimal",
]);

export const appSettingsSchema = z
  .object({
    deviceName: z.string().trim().min(1).max(80),
    fullscreenOnLaunch: z.boolean(),
    launchAtLogin: z.boolean(),
    hideControlsAutomatically: z.boolean(),
    showLyricsByDefault: z.boolean(),
    experimentalLrclibEnabled: z.boolean(),
    lyricOffsetMs: z.number().int().min(-10_000).max(10_000),
    motionIntensity: z.number().min(0).max(1),
    backgroundBlur: z.number().min(0).max(1),
    artworkScale: z.number().min(0.75).max(1.25),
    menuBarEnabled: z.boolean(),
    textScale: z.number().min(0.8).max(1.5),
    visualMode: visualModeSchema,
  })
  .strict();

export const settingsPatchSchema = appSettingsSchema.partial().strict();

export const defaultSettings: AppSettings =
  appSettingsSchema.parse(DEFAULT_SETTINGS);

export const spotifyTokenRecordSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    tokenType: z.string().min(1),
    scopes: z.array(z.string().min(1)).max(64),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export const spotifyTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    scope: z.string().optional(),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
  })
  .passthrough();

export const authStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("signedOut") }).strict(),
  z
    .object({
      status: z.literal("authenticated"),
      expiresAt: z.number().int().positive(),
      scopes: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      status: z.literal("expired"),
      reason: z.enum([
        "configuration",
        "keychain",
        "network",
        "refreshRejected",
        "unknown",
      ]),
    })
    .strict(),
]);

export const webPlaybackTokenSchema = z
  .object({
    accessToken: z.string().min(1),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export const fullscreenRequestSchema = z
  .object({ fullscreen: z.boolean() })
  .strict();

export const fullscreenStateSchema = z.boolean();

export const externalUrlRequestSchema = z
  .object({ url: z.string().url().max(2_048) })
  .strict();

export const menuCommandSchema = z.enum(["playPause", "previous", "next"]);

export const menuNowPlayingStateSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    artist: z.string().trim().min(1).max(300),
    isPlaying: z.boolean(),
  })
  .strict()
  .nullable();

export const lyricsTrackIdentitySchema = z
  .object({
    spotifyTrackId: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    artist: z.string().trim().min(1).max(300),
    album: z.string().trim().min(1).max(300).optional(),
    durationMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
    isrc: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/)
      .optional(),
  })
  .strict();

export const lyricsImportRequestSchema = z
  .object({
    track: lyricsTrackIdentitySchema.optional(),
  })
  .strict();

export const lyricsMatchRequestSchema = z
  .object({
    track: lyricsTrackIdentitySchema,
  })
  .strict();

export const importedLrcIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const importedLrcIdRequestSchema = z
  .object({
    id: importedLrcIdSchema,
  })
  .strict();

export const importedLrcRecordSchema = z
  .object({
    id: importedLrcIdSchema,
    fileName: z.string().trim().min(1).max(240),
    sizeBytes: z.number().int().nonnegative().max(MAX_LRC_FILE_BYTES),
    importedAt: z.string().datetime(),
    spotifyTrackId: z.string().trim().min(1).max(160).optional(),
    isrc: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/)
      .optional(),
    title: z.string().trim().min(1).max(300).optional(),
    artist: z.string().trim().min(1).max(300).optional(),
    album: z.string().trim().min(1).max(300).optional(),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000)
      .optional(),
  })
  .strict();

export const importedLrcRecordsSchema = z.array(importedLrcRecordSchema);

export const importedLrcFileSchema = importedLrcRecordSchema
  .extend({
    content: z.string().max(MAX_LRC_FILE_BYTES),
  })
  .strict();

export const importedLrcDeleteResultSchema = z
  .object({
    deleted: z.boolean(),
  })
  .strict();

export const lrclibRequestIdSchema = z.string().uuid();

const lrclibMetadataTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 31 && codePoint !== 127;
      }),
    "Track metadata cannot contain control characters.",
  );

const lrclibTrackIdentitySchema = lyricsTrackIdentitySchema
  .extend({
    spotifyTrackId: z.string().regex(/^[A-Za-z0-9]{22}$/),
    title: lrclibMetadataTextSchema,
    artist: lrclibMetadataTextSchema,
    album: lrclibMetadataTextSchema,
  })
  .strict();

export const lrclibLookupRequestSchema = z
  .object({
    requestId: lrclibRequestIdSchema,
    track: lrclibTrackIdentitySchema,
  })
  .strict();

export const lrclibCancelRequestSchema = z
  .object({
    requestId: lrclibRequestIdSchema,
  })
  .strict();

const lrclibLookupBaseSchema = z
  .object({
    provider: z.literal("lrclib"),
  })
  .strict();

export const lrclibLyricsLookupResultSchema = z.discriminatedUnion("status", [
  lrclibLookupBaseSchema
    .extend({
      status: z.literal("found"),
      format: z.enum(["lrc", "plain"]),
      content: z.string().min(1).max(1_000_000),
    })
    .strict(),
  lrclibLookupBaseSchema
    .extend({
      status: z.literal("not-found"),
    })
    .strict(),
  lrclibLookupBaseSchema
    .extend({
      status: z.literal("instrumental"),
    })
    .strict(),
  lrclibLookupBaseSchema
    .extend({
      status: z.literal("disabled"),
    })
    .strict(),
  lrclibLookupBaseSchema
    .extend({
      status: z.literal("rate-limited"),
      retryAfterMs: z.number().int().nonnegative().max(60 * 60 * 1_000),
    })
    .strict(),
  lrclibLookupBaseSchema
    .extend({
      status: z.literal("error"),
      code: z.enum(["network", "timeout", "invalid-response"]),
    })
    .strict(),
]);

export const lrclibLookupCancelResultSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export const cacheInfoSchema = z
  .object({
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const cacheClearResultSchema = z
  .object({
    cleared: z.literal(true),
  })
  .strict();

export const recoveryStateSchema = z
  .object({
    suspended: z.boolean(),
    screenLocked: z.boolean(),
    online: z.boolean(),
    observedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const recoverySignalSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("power"),
        event: z.enum([
          "suspend",
          "resume",
          "lock-screen",
          "unlock-screen",
        ]),
        state: recoveryStateSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("network"),
        online: z.boolean(),
        state: recoveryStateSchema,
      })
      .strict(),
  ])
  .superRefine((signal, context) => {
    const consistent =
      signal.kind === "network"
        ? signal.online === signal.state.online
        : signal.event === "suspend"
          ? signal.state.suspended
          : signal.event === "resume"
            ? !signal.state.suspended
            : signal.event === "lock-screen"
              ? signal.state.screenLocked
              : !signal.state.screenLocked;

    if (!consistent) {
      context.addIssue({
        code: "custom",
        message: "Recovery signal and state do not agree.",
      });
    }
  });

export const emptyIpcPayloadSchema = z.undefined();
