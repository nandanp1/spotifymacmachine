# Aura Player contributor guide

Read `AURA_PLAYER_CODEX(1).md`, this file, and `TASKS.md` before changing the
application.

## Architecture summary

Aura Player is an Electron 37 application with three explicit trust zones:

- `src/main/` owns Electron lifecycle, windows, OAuth callbacks, Keychain
  access, menu-bar integration, local files, and privileged IPC handlers.
- `src/preload/` exposes a minimal typed `contextBridge` surface. It contains no
  product UI and no broad passthrough primitives. Its build is a single bundled
  CommonJS file because sandboxed Electron preloads cannot execute ESM or load
  arbitrary external packages.
- `src/renderer/` owns React UI, client-side visual rendering, browser-safe
  Spotify SDK integration, and user interactions. It cannot import Node or
  Electron modules.
- `src/shared/` contains serializable types, Zod schemas, constants, and pure
  utilities used across boundaries. Keep it free of Electron globals and DOM
  assumptions unless a file is explicitly browser-only.

The renderer depends on abstractions such as `PlaybackService`,
`LyricsProvider`, and `VisualEngine`. Do not couple React components directly to
a Spotify SDK, storage backend, or scraping implementation.

## Folder ownership

| Path | Responsibility |
| --- | --- |
| `src/main/auth.ts` | PKCE, loopback callback, token exchange/refresh |
| `src/main/secure-store.ts` | Keychain-only credential persistence |
| `src/main/windows.ts` | Secure BrowserWindow construction and navigation |
| `src/main/ipc.ts` | Validated privileged IPC handlers |
| `src/preload/preload.ts` | Narrow typed renderer API |
| `src/renderer/features/auth/` | Login state and renderer presentation |
| `src/renderer/features/player/` | Playback abstraction and state |
| `src/renderer/features/lyrics/` | LRC parsing, providers, synchronization |
| `src/renderer/features/artwork/` | Local palette and procedural visuals |
| `src/renderer/features/devices/` | Device discovery and explicit transfer |
| `src/renderer/features/settings/` | Non-sensitive preferences |
| `src/shared/schemas.ts` | Shared settings and IPC validation schemas |
| `tests/unit/` | Pure deterministic tests |
| `tests/e2e/` | Electron flows with mocked external services |

Do not create duplicate implementations in a second folder. Move or reuse the
existing abstraction when ownership needs to change.

## Coding conventions

- Use TypeScript in strict mode; do not suppress errors with `any`,
  `@ts-ignore`, or disabled lint rules.
- Validate data at every external boundary. Types do not replace runtime Zod
  parsing.
- Prefer discriminated unions for loading, ready, empty, reconnecting, and error
  states.
- Keep side effects behind services and expose cleanup functions for every
  subscription or listener.
- Use abort signals for cancellable network requests.
- Keep user-facing errors actionable and separate from redacted diagnostic
  details.
- Use `@main`, `@preload`, `@renderer`, and `@shared` aliases only within their
  allowed trust zones.
- Renderer components must remain keyboard accessible and label every icon-only
  control.
- Respect `prefers-reduced-motion`; pause visuals while hidden and reduce work
  while paused.
- Use the bundled Newsreader and Albert Sans variable fonts. Do not introduce a
  runtime font-network dependency.

## Security invariants

- Browser windows use `contextIsolation: true`, `nodeIntegration: false`, and
  `sandbox: true`.
- Only main owns tokens, Keychain, local callback sockets, native menus, and
  privileged filesystem access.
- Tokens never enter localStorage, renderer logs, crash messages, URLs, test
  snapshots, or analytics.
- Never ship a Spotify client secret.
- Every IPC payload is allowlisted and parsed with Zod on receipt.
- Do not expose `ipcRenderer.send`, arbitrary channel names, raw filesystem
  paths, shell execution, or unrestricted fetch through preload.
- Block unexpected navigation and window creation. Open only approved external
  HTTPS URLs in the system browser.
- Use a restrictive Content Security Policy; do not add `unsafe-eval`.
- Never render remote HTML.
- Sanitize imported names and verify resolved paths before file access.
- Do not weaken sandboxing, hardened runtime, or Electron warnings to bypass a
  development problem.

## Spotify and lyrics policy

- Request only scopes used by shipped features.
- Never claim playback or Connect works until verified in a packaged build.
- Do not repeatedly force device transfer.
- Never download, cache, proxy, record, modify, or inspect Spotify audio.
- Spotify's Web API does not supply full lyrics.
- Only user-imported `.lrc`, properly licensed providers, and explicitly
  authorized source adapters are permitted.
- Authorized adapters respect terms, `robots.txt`, crawl delay, access control,
  strict rate limits, and backoff. They are disabled by default.
- Do not target Spotify, Genius, Musixmatch, or sources that prohibit automated
  collection.
- Do not include copyrighted lyric text in fixtures.

## Required checks

After meaningful changes, run the smallest relevant command and finish with the
full gate before handoff:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run test:e2e` after changing application flows, IPC, window behavior,
keyboard shortcuts, or persistence. Use `npm run package:mac` only when native
packaging needs validation.

Tests must not require a real Spotify account. Live Spotify and packaging
verification use the manual checklist in `README.md`.

## macOS 11 compatibility

Electron is pinned to 37 because Electron 38 drops macOS 11. Do not change the
major version without an explicit product decision to raise the minimum macOS
version. Because the pinned branch ages, treat Electron security advisories as
release blockers and document the compatibility/security tradeoff.

Avoid macOS APIs introduced after Big Sur. Rebuild and verify `keytar` on both
x64 and arm64. A successful cross-build is not a substitute for physical-device
testing.

## Definition of done

A change is done only when:

- its real behavior is implemented without a fake success path;
- privileged inputs are validated and sensitive data remains in main;
- loading, empty, offline, denied, and failure states are honest and actionable;
- keyboard, focus, contrast, and Reduce Motion behavior are covered;
- subscriptions and native listeners clean up correctly;
- relevant unit/e2e tests pass;
- lint, typecheck, and build pass;
- documentation and `TASKS.md` match reality;
- any unverified Spotify, DRM, signing, or architecture claim is explicitly
  marked as requiring manual verification.
