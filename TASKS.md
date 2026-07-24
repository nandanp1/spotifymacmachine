# Aura Player build checklist

This checklist records implemented repository work separately from external
verification. Checking an implementation task never implies that Spotify, DRM,
signing, or packaged behavior has passed its manual gate.

## Phase 1 — Foundation

- [x] Replace the Sites/vinext starter with Electron + React + TypeScript + Vite.
- [x] Pin Electron 37 for the macOS 11 target.
- [x] Configure main, preload, and renderer builds with `electron-vite`.
- [x] Configure electron-builder for macOS x64 and arm64 DMG/ZIP artifacts.
- [x] Add Tailwind, Framer Motion, Zustand, TanStack Query, Zod, and Lucide.
- [x] Bundle Newsreader and Albert Sans variable fonts for offline use.
- [x] Add ESLint, Vitest, Playwright, and strict TypeScript projects.
- [x] Add environment and contributor documentation.
- [x] Add a production application icon.
- [x] Add hardened-runtime signing entitlements without disabling library
      validation.
- [x] Confirm the base window launches with secure BrowserWindow preferences.
- [x] Run the full local quality gate after application entry points land.

## Phase 2 — Authentication

- [x] Generate cryptographically random OAuth state and PKCE verifier/challenge.
- [x] Open Spotify authorization in the default browser.
- [x] Bind a loopback callback to `127.0.0.1:43821` and only the expected path.
- [x] Validate state and callback parameters.
- [x] Exchange and refresh tokens without a client secret.
- [x] Store credentials only in macOS Keychain through `keytar`.
- [x] Delete credentials on sign-out.
- [x] Handle cancelled login, expired login, callback failure, and Keychain
      failure.
- [x] Unit-test PKCE and redirect validation.
- [x] Unit-test token expiry math, cancellation races, and authentication error
      mapping.

## Phase 3 — Playback and Connect

- [x] Implement the `PlaybackService` contract.
- [x] Load and initialize Spotify's Web Playback SDK.
- [x] Register the name `Aura Player — Mac`.
- [x] Synchronize state without inventing success.
- [x] Implement play, pause, previous, next, seek, and volume.
- [x] Handle ready, not-ready, authentication, account, initialization, and
      playback errors.
- [x] Implement recovery after token refresh, sleep/wake signals, and temporary
      network loss.
- [x] Expose available devices and explicit user-initiated transfer.
- [x] Explain Premium, SDK, no-device, and transfer-rejected states.
- [x] Unit-test player/store transitions, SDK sequencing, retries, and API error
      mapping.

### Manual DRM gate

- [ ] Verify Spotify playback inside a packaged Electron 37 application on
      macOS 11 x64.
- [ ] Verify Spotify playback inside a packaged Electron 37 application on
      Apple Silicon.
- [ ] Record the exact DRM/EME result; stop and document the blocker before
      selecting any alternative.

## Phase 4 — Now playing and procedural visuals

- [x] Build the artwork-first 42/58 desktop composition.
- [x] Add metadata, progress, playback controls, volume, and device status.
- [x] Implement keyboard shortcuts and fullscreen artwork behavior.
- [x] Auto-hide controls without hiding focused controls.
- [x] Implement `VisualEngine` with deterministic track seeds.
- [x] Extract artwork colors locally.
- [x] Crossfade palettes and track art.
- [x] Add low-power Canvas 2D fallback.
- [x] Pause hidden-window animation and respect Reduce Motion.
- [x] Test preview track transitions, lyric shortcuts, responsive layouts, and
  the fullscreen request boundary.
- [ ] Verify native fullscreen transitions on a physical target Mac.

## Phase 5 — Lyrics

- [x] Parse standard `.lrc` timestamps and metadata.
- [x] Import and safely persist user-provided lyric files.
- [x] Match by track ID, ISRC, and normalized artist/title.
- [x] Select and center the active line.
- [x] Add a user-controlled synchronization offset.
- [x] Handle plain, instrumental, missing, and malformed lyrics.
- [x] Add an unconfigured licensed-provider adapter.
- [x] Add a disabled authorized-source adapter with configuration validation,
      explicit permission gating, `robots.txt`, rate limiting, and strict
      request serialization.
- [x] Add exponential retry backoff to the authorized-source transport.
- [x] Unit-test parsing, matching, normalization, offsets, and active-line
      boundaries using original fixture text.

## Phase 6 — Devices and library

- [x] Build device discovery, current-device status, and transfer UI.
- [x] Add search.
- [x] Add saved tracks and playlists.
- [x] Browse playlist tracks and start playback.
- [x] Add supported queue/play-next/open-in-Spotify actions.
- [x] Add loading, empty, rate-limit, offline, and unavailable states.

## Phase 7 — Native polish

- [x] Add an optional menu-bar controller.
- [x] Add fullscreen-on-launch and launch-at-login.
- [x] Persist validated non-sensitive settings.
- [x] Add lyric offset, motion, blur, art scale, text size, and tray settings.
- [x] Add cache clearing without touching Keychain credentials.
- [x] Add cache inspection.
- [ ] Complete keyboard and screen-reader audit.
- [ ] Measure idle CPU while paused and hidden.
- [ ] Verify sleep/wake recovery.

## Testing and release gates

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run test:e2e`
- [x] `npm run build`
- [x] `npm run package:mac` (unsigned x64/arm64 DMG and ZIP artifacts produced)
- [ ] Test the x64 artifact on an Intel Mac running macOS 11.
- [ ] Test the arm64 artifact on Apple Silicon.
- [ ] Verify `keytar` works in both packaged architectures.
- [ ] Supply Apple Developer ID signing outside source control.
- [x] Add hardened-runtime entitlements without disabling sandbox or library
      validation protections.
- [ ] Sign and notarize release artifacts.
- [ ] Complete every manual Spotify check in `README.md`.
- [ ] Re-review the Electron 37 security/macOS 11 compatibility decision before
      each release.

## Known external gates

- Electron 38 and newer do not satisfy the macOS 11 requirement.
- The locked Electron 37 runtime has high-severity advisories whose automatic
  fix raises the Electron major; public distribution requires an explicit
  security/product decision.
- Spotify Premium is required for playback and Connect.
- Packaged Web Playback DRM support is unverified.
- Spotify development mode may restrict users and distribution.
- Apple signing and notarization require credentials not present here.
- Spotify's public Web API does not provide full lyrics.
