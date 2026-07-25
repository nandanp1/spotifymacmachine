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
- [x] Discover available Spotify devices through the Web API.
- [x] Require the user to select one exact remote-control target.
- [x] Transfer an inactive selected target once with `play: false`, then confirm
      that the same device became active.
- [x] Target play, pause, previous, next, seek, and supported volume commands to
      the selected device ID.
- [x] Poll current playback and synchronize metadata, progress, and restrictions
      without inventing success.
- [x] Clear readiness when Spotify reports a different or unavailable target.
- [x] Handle authentication, Premium, no-device, transfer-rejected, offline, and
      rate-limit errors honestly.
- [x] Implement recovery after token refresh, sleep/wake signals, and temporary
      network loss without repeatedly forcing transfer.
- [x] Unit-test player/store transitions, explicit device targeting, polling,
      retries, and Spotify API validation/error mapping.

### Embedded playback decision

- [x] Probe stock Electron 37 for Spotify's required Widevine EME capability.
- [x] Record the blocker: the macOS 11-compatible runtime does not expose
      Widevine, and Spotify's Web Playback SDK reports an initialization error.
- [x] Stop using the Web Playback SDK in the shipped path and remove the
      unnecessary `streaming` scope.
- [x] Ship an honest Spotify Connect remote controller instead: Aura
      authenticates, discovers devices, and controls the explicitly selected
      device while audio remains on that device.
- [x] Do not register or present `Aura Player — Mac` as a Spotify output device.
- [ ] Reconsider embedded playback only through a separately supported DRM
      architecture and an explicit decision to raise the minimum macOS version.

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
- [x] Keep the full transcript available around a fixed reading axis.
- [x] Animate adjacent line changes and line-level timing without inventing
      word-level synchronization.
- [x] Give timed lyrics a distinct Darkroom Score treatment with past/future
      states, an exposure halo, and a vertical timing gauge.
- [x] Add a user-controlled synchronization offset.
- [x] Handle plain, instrumental, loading, missing, and malformed lyrics.
- [x] Make plain and synchronized lyrics keyboard-scrollable and honor Reduce
      Motion and increased contrast.
- [x] Add an unconfigured licensed-provider adapter.
- [x] Add a disabled authorized-source adapter with configuration validation,
      explicit permission gating, `robots.txt`, rate limiting, and strict
      request serialization.
- [x] Add exponential retry backoff to the authorized-source transport.
- [x] Add an explicit, disabled-by-default LRCLIB experiment that checks local
      files first and sends only title, artist, album, and duration through a
      fixed main-process endpoint.
- [x] Bound LRCLIB requests with cancellation, timeout, response-size,
      identity, serialization, cooldown, and memory-only cache controls.
- [x] Unit-test parsing, matching, normalization, offsets, and active-line
      boundaries using original fixture text.
- [ ] Obtain written Spotify approval and contracted timed-lyric display rights.
- [ ] Integrate the approved provider through a trusted backend without exposing
      credentials in Electron or persisting content beyond the license terms.

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
- [x] Add lyric offset, motion, blur, art scale, text size, tray, and
      experimental LRCLIB settings.
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
- Spotify Premium is required for Spotify Connect remote-control operations.
- Aura does not play Spotify audio locally or appear as a Spotify output device;
  audio remains on the explicitly selected Spotify device.
- Stock Electron 37 lacks the Widevine EME capability required for embedded
  Spotify Web Playback SDK playback on the macOS 11 compatibility line.
- Live and packaged remote-control behavior still requires physical testing on
  each target architecture.
- Spotify development mode may restrict users and distribution.
- Apple signing and notarization require credentials not present here.
- Spotify's public Web API does not provide full lyrics.
- Online lyric lookup for Spotify playback remains gated on applicable lyric
  rights and written Spotify approval; do not silently enable a community API.
