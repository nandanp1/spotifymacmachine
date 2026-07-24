# Aura Player

Aura Player is an artwork-first Spotify desktop experience for macOS. It pairs
large album art with synchronized lyrics and a restrained procedural visual
environment, while keeping playback controls, device transfer, library access,
and settings close at hand.

The project is intentionally original rather than a reproduction of Spotify's
interface. Its visual direction is editorial, cinematic, soft, and luxurious.

> [!IMPORTANT]
> Aura Player is under active development. The repository includes a real
> Electron foundation, but live Spotify playback, packaged DRM compatibility,
> Apple signing, and Spotify Connect behavior are not considered verified until
> the manual checks in this document have passed on physical Macs.

## Screenshots

| Artwork-first now playing | Secondary library drawer |
| --- | --- |
| ![Aura Player now-playing room](./docs/screenshots/aura-main.png) | ![Aura Player library drawer](./docs/screenshots/aura-library.png) |

## Platform support

- macOS 11 Big Sur or newer
- Intel x64
- Apple Silicon arm64, subject to native-dependency verification
- Spotify Premium for Web Playback SDK playback and Spotify Connect behavior

### Why Electron 37 is pinned

This repository pins Electron to `37.10.3`. Electron 38 drops macOS 11, so
upgrading across that major boundary would break the stated Big Sur target.
Pinning an older major is a compatibility compromise, not a permanent security
strategy: Electron 37 will eventually stop receiving upstream security fixes.
Maintainers must review Electron advisories, avoid untrusted content, and plan a
separate supported-OS branch or a higher minimum macOS version when the risk of
remaining on Electron 37 is no longer acceptable.

At lockfile generation on July 24, 2026, `npm audit` reports high-severity
advisories against the Electron 37 development dependency whose automated fix
requires a later Electron major. `npm audit --omit=dev` reports no production
package advisories, but that does not make the embedded Electron runtime safe:
Electron is a development dependency only because it supplies the packaged
runtime. These advisories are an accepted, documented blocker for public
distribution while macOS 11 remains mandatory.

The package's Node.js requirement applies to development tooling. Packaged
applications use the Node and Chromium versions embedded in Electron 37.

## Current implementation status

The definitive running checklist lives in [TASKS.md](./TASKS.md). In summary:

- The Electron/Vite/React/TypeScript application launches with secure
  main/preload/renderer boundaries, and unsigned x64/arm64 DMG and ZIP packages
  build locally.
- PKCE authentication, a loopback callback, Keychain token storage and refresh,
  and credential-deleting sign-out are implemented.
- The Spotify Web Playback SDK adapter, honest player state, playback controls,
  Connect device registration, device discovery, and explicit transfer are
  implemented but still require a Premium account and packaged DRM verification.
- The artwork-first interface, deterministic Canvas visual engine, local palette
  extraction, six visual modes, synchronized and restart-persistent `.lrc`
  import, provider adapters, menu-bar controls, settings, shortcuts, and preview
  experience are implemented.
- The secondary library supports live Spotify search, saved tracks, playlists,
  playlist browsing, pagination, playback, queue/play-next, and safe
  open-in-Spotify actions, with honest loading, empty, offline, rate-limit, and
  unavailable states.
- Native power/network recovery signals, cache inspection and clearing, strict
  playback-state sequencing, and credential-safe sign-out cancellation are
  implemented. Physical sleep/wake behavior still requires manual verification.
- Lint, strict type checking, 136 unit tests, three isolated Electron
  end-to-end flows, the production build, and the x64/arm64 packaging command
  pass.
- Apple signing/notarization, physical Intel/Apple Silicon testing, and all live
  Spotify/DRM checks remain external release gates.

## Prerequisites

- macOS 11 or newer
- Node.js `>=22.13.0`
- npm 10 or newer
- Xcode Command Line Tools for rebuilding `keytar`
- A Spotify developer application
- A Spotify Premium account for playback testing
- Apple Developer signing credentials for signed release artifacts

## Spotify developer application setup

1. Create or open an application in the Spotify Developer Dashboard.
2. Copy its client ID.
3. Register this exact redirect URI:

   ```text
   http://127.0.0.1:43821/callback
   ```

4. Add your Spotify account to the application's allowlist while the
   application remains in development mode.
5. Copy `.env.example` to `.env` and add the client ID:

   ```dotenv
   VITE_SPOTIFY_CLIENT_ID=your_client_id
   VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:43821/callback
   ```

Spotify client IDs are public identifiers. Do not create, embed, or commit a
Spotify client secret. Desktop authentication must use Authorization Code Flow
with PKCE.

Request only scopes used by the finished application. The expected set is:

```text
streaming
user-read-email
user-read-private
user-read-playback-state
user-modify-playback-state
user-read-currently-playing
playlist-read-private
playlist-read-collaborative
user-library-read
```

Remove any scope whose corresponding feature is not shipped.

## Install and run

```bash
npm install
npm run dev
```

The install step rebuilds native production dependencies for the pinned
Electron runtime. If `keytar` fails to build, confirm Xcode Command Line Tools
are installed, then run:

```bash
npm run rebuild:native
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run main, preload, and renderer processes with hot reload |
| `npm start` | Preview a completed Electron build |
| `npm run lint` | Run ESLint with warnings treated as failures |
| `npm run typecheck` | Type-check Node, web, and test projects |
| `npm test` | Run Vitest unit tests once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Build and run Playwright Electron tests |
| `npm run build` | Type-check and build all Electron process bundles |
| `npm run package` | Produce an unpacked application for local inspection |
| `npm run package:mac` | Build x64 and arm64 DMG and ZIP artifacts |

## Architecture

```text
src/
├── main/       Electron lifecycle, windows, OAuth callback, Keychain, tray, IPC
├── preload/    Narrow typed contextBridge API
├── renderer/   React UI, Spotify SDK adapter, visuals, lyrics, library
└── shared/     IPC schemas, shared types, constants, settings validation
```

The renderer must never import Node or Electron modules. Main-process
capabilities are exposed through a narrow preload API, and every IPC payload is
validated with Zod on the receiving side.

The main bundle uses ESM. The sandboxed preload is deliberately emitted as one
bundled CommonJS file; Electron does not support ESM imports in sandboxed
preloads, and its restricted preload `require` cannot load arbitrary npm
packages. Third-party validators are bundled into the preload, leaving only
Electron built-ins as runtime imports. Do not re-enable dependency
externalization for that build.

### Authentication and token storage

- Generate the OAuth state, PKCE verifier, and challenge locally.
- Open Spotify authorization in the user's default browser.
- Accept callbacks only at the configured loopback address and exact path.
- Compare OAuth state using a timing-safe strategy where practical.
- Store access and refresh tokens only in macOS Keychain through `keytar`.
- Keep tokens out of renderer persistence, query strings after callback
  handling, crash reports, analytics, and logs.
- Delete stored credentials on sign-out.

### Playback boundary

Renderer components depend on a `PlaybackService` interface rather than calling
Spotify directly. The included implementation wraps Spotify's Web Playback SDK,
but the abstraction remains replaceable and demo state is explicitly labeled so
it cannot be mistaken for successful Spotify playback.

Spotify's browser SDK is loaded at runtime from Spotify. A successful web build
does not prove packaged playback support. Electron's Chromium distribution may
not satisfy every DRM/EME requirement used by Spotify. Confirm the SDK inside a
packaged Electron application before treating playback or Connect registration
as supported. If it fails, document the precise error and stop before choosing
an alternative; never capture, download, proxy, record, or alter Spotify audio.

### Lyrics

Spotify's public Web API does not provide full lyrics. Aura Player supports a
provider-independent model:

- user-imported `.lrc` files;
- a separately licensed lyrics API;
- source adapters for sites the user owns, controls, or has explicit permission
  to scrape.

Authorized scraper adapters must be disabled by default and must respect source
terms, `robots.txt`, crawl delay, strict rate limits, and access controls. Never
bypass authentication, CAPTCHAs, paywalls, robots restrictions, or anti-bot
systems. Never target Spotify, Genius, Musixmatch, or another prohibited source.
Do not bundle copyrighted lyric text in fixtures.

Imported files are stored in the application user-data directory with validated
metadata sidecars. They are matched by Spotify track ID, ISRC, or normalized
artist/title, can be listed and removed in Settings, and never leave the Mac.

### Local settings

Non-sensitive preferences may be persisted locally. Credentials and tokens may
not. Settings must be parsed through the shared schema before use so corrupted
or older values fall back safely.

## Security model

Every application window must use these defaults:

```ts
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: PRELOAD_PATH
}
```

Additional invariants:

- maintain a restrictive Content Security Policy;
- deny unexpected window creation and navigation;
- open allowlisted HTTPS links through the system browser;
- reject malformed or oversized IPC payloads;
- never render remote HTML;
- sanitize imported file names and resolve paths defensively;
- never disable Electron security warnings;
- never log tokens, personal data, lyric contents, or full Spotify responses;
- do not expose arbitrary filesystem, shell, network, or IPC primitives to the
  renderer.

See [AGENTS.md](./AGENTS.md) before changing process boundaries.

## Testing

Unit tests do not require a Spotify account and cover pure behavior such as:

- PKCE generation and OAuth-state validation;
- token expiry calculations and Spotify error mapping;
- LRC parsing, lyric matching, and active-line selection;
- player/store transitions;
- settings defaults and validation;
- IPC schema validation.

Playwright tests launch Electron with a unique temporary user-data directory and
an explicit ephemeral credential store. They exercise the honest local preview,
track changes, keyboard lyrics, settings persistence, the sandboxed preload
bridge, and the fullscreen request boundary without reading the developer's
real Keychain. Live Spotify checks are deliberately separate because they
require a developer application and a Premium account.

Run the standard local gate:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Manual Spotify verification

Use a Spotify developer application and a physical Premium account. Record the
Electron version, macOS version, CPU architecture, and result of each check.

- [ ] Login opens in the default browser and returns only through the expected
      loopback callback.
- [ ] Cancelled login and state mismatch show useful errors.
- [ ] Tokens refresh after expiration.
- [ ] Credentials survive restart through Keychain and disappear on sign-out.
- [ ] The packaged player becomes ready without a DRM/initialization error.
- [ ] `Aura Player — Mac` appears in Available Devices.
- [ ] Playback transfers from a phone to Aura Player only after user action.
- [ ] Playback transfers from Aura Player to another device.
- [ ] Play, pause, previous, next, seek, and volume control real playback.
- [ ] Track metadata, duration, and artwork update correctly.
- [ ] Sleep/wake and a temporary network interruption recover cleanly.
- [ ] A non-Premium account receives a clear explanation.
- [ ] Spotify rate limiting backs off without a retry loop.
- [ ] Tokens and private data are absent from logs.

## Packaging

Unsigned local artifacts can be built with:

```bash
npm run package:mac
```

The builder declares DMG and ZIP targets for x64 and arm64 with a macOS 11
minimum. A declaration is not proof that both artifacts work: `keytar`, Web
Playback DRM, login callbacks, fullscreen, tray behavior, and sleep/wake
recovery must be exercised on each architecture.

Distribution requires an Apple Developer ID Application certificate,
notarization credentials, and an explicit release process. Production icons and
hardened-runtime entitlements are included; signing credentials are
intentionally absent from the repository. Do not disable hardened runtime or
library validation to make signing pass.

## Spotify development-mode limitations

Spotify may restrict development applications to explicitly allowlisted users,
limit quotas, or require review before broader distribution. Aura Player should
be treated as personal/non-commercial software unless Spotify grants broader
approval. Spotify policy and SDK availability can change independently of this
repository; verify current terms before any release.

## Troubleshooting

### `keytar` fails during install or packaging

Install Xcode Command Line Tools, confirm the active architecture, then run
`npm run rebuild:native`. Universal packaging still needs separate validation
of the x64 and arm64 binaries.

### Spotify redirects to a browser error

Confirm the dashboard redirect URI exactly matches
`http://127.0.0.1:43821/callback`, including scheme, host, port, and path. Also
confirm the account is allowed to use the development application.

### Login succeeds but playback does not start

Confirm the account is Premium, inspect the human-readable SDK error state, and
test the packaged application. Login success does not establish DRM support or
an active Spotify device.

### Aura Player does not appear in Available Devices

Wait for the Web Playback SDK `ready` event and a non-empty device ID. Do not
force-transfer in a retry loop. Confirm Premium eligibility and inspect any SDK
account or initialization error.

### Lyrics are unavailable

Import a matching `.lrc` file or configure a licensed provider. Aura Player
must not invent lyrics or silently scrape an unapproved source.

## Known limitations

- Spotify playback and Connect remain gated by Premium and packaged DRM
  verification.
- Electron 37 preserves macOS 11 compatibility at the cost of an older Chromium
  security baseline.
- Apple signing and notarization require credentials supplied outside source
  control.
- Spotify lyrics are unavailable through the public Web API.
- Licensed lyric-provider credentials are not bundled.
- Authorized scraper providers are off until explicitly configured.
- Development-mode Spotify applications may be limited to allowlisted users.

## License

This repository is currently private and unlicensed. Spotify and its marks are
the property of Spotify AB; Aura Player is not affiliated with or endorsed by
Spotify.
