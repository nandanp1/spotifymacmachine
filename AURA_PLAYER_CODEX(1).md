# Codex Build Brief: Aesthetic Spotify Display for macOS 11

## Mission

Build a polished desktop music player for **macOS 11 Big Sur** that feels like a living digital art piece.

The app should let a user:

- Sign in with Spotify.
- Play and control Spotify music.
- Display the current album artwork prominently.
- Show synchronized lyrics in a beautiful, cinematic layout.
- Appear in Spotify's **Available Devices** menu so playback can be transferred from a phone to the Mac.
- Run smoothly on macOS 11.
- Feel minimal, immersive, premium, and visually impressive.

Working name: **Aura Player**

---

## Important Product Constraints

1. Spotify playback and Spotify Connect functionality require a **Spotify Premium** account.
2. Use Spotify OAuth with **Authorization Code Flow with PKCE**.
3. Never embed a Spotify client secret in the desktop application.
4. Spotify's public Web API does not provide full lyric text.
5. Build a pluggable lyrics acquisition system supporting:
   - user-imported `.lrc` files,
   - properly licensed lyrics APIs,
   - and scraper adapters for sources the user owns, controls, or has explicit permission to scrape.
6. Do not bypass logins, paywalls, CAPTCHAs, robots restrictions, anti-bot systems, or access controls.
7. Do not scrape Spotify, Musixmatch, Genius, or any source whose terms prohibit automated collection.
8. Do not download, cache, record, alter, or redistribute Spotify audio.
8. Treat this as a personal/non-commercial app unless Spotify grants broader approval.
9. Store tokens securely in the macOS Keychain.
10. Do not log access tokens, refresh tokens, lyric contents, or personal data.

---

## Recommended Architecture

Create the project as a **macOS desktop app using Electron, React, TypeScript, and Vite**.

Electron is selected so the app can use Spotify's browser-based SDK and modern web visuals. Before relying on production playback, verify that the packaged Electron build can support Spotify's DRM requirements on macOS 11. Keep playback code behind an abstraction so an alternative implementation can replace it if needed.

### Core stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- Zustand
- TanStack Query
- Zod
- Vitest
- Playwright
- electron-builder
- Keytar for macOS Keychain storage

### Target compatibility

- macOS 11 Big Sur and newer
- Intel x64 build
- Apple Silicon arm64 build when dependency support permits
- Avoid APIs that require newer macOS versions
- Set the deployment target to macOS 11 where applicable

---

## Repository Structure

```text
aura-player/
├── .env.example
├── .gitignore
├── AGENTS.md
├── README.md
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main/
│   │   ├── main.ts
│   │   ├── windows.ts
│   │   ├── deep-links.ts
│   │   ├── secure-store.ts
│   │   └── ipc.ts
│   ├── preload/
│   │   └── preload.ts
│   ├── renderer/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── player/
│   │   │   ├── lyrics/
│   │   │   ├── artwork/
│   │   │   ├── devices/
│   │   │   └── settings/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── stores/
│   │   ├── styles/
│   │   └── types/
│   └── shared/
│       ├── schemas.ts
│       └── constants.ts
├── tests/
│   ├── unit/
│   └── e2e/
└── assets/
    ├── icons/
    └── placeholders/
```

---

## Required Features

### 1. Spotify login

Implement Spotify OAuth using Authorization Code Flow with PKCE.

Requirements:

- Open Spotify authorization in the user's default browser.
- Receive the callback using a local loopback server or registered custom URL scheme.
- Validate the OAuth `state`.
- Generate and verify the PKCE code verifier and challenge.
- Store tokens in macOS Keychain using Keytar.
- Refresh access tokens automatically.
- Provide clear logged-out, loading, success, and failure states.
- Add a sign-out button that deletes stored credentials.

Environment variables:

```env
VITE_SPOTIFY_CLIENT_ID=
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:43821/callback
```

Suggested scopes:

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

Only request scopes actually used by the finished app.

---

### 2. Spotify playback

Create a playback service interface so the renderer does not directly depend on a single SDK.

```ts
export interface PlaybackService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  play(uri?: string): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getState(): Promise<PlayerState | null>;
  subscribe(listener: (state: PlayerState | null) => void): () => void;
}
```

The implementation should:

- Initialize Spotify's Web Playback SDK.
- Give the player a recognizable name such as `Aura Player — Mac`.
- Obtain and expose the Spotify device ID.
- Handle player-ready, not-ready, authentication, account, playback, and initialization errors.
- Keep player state synchronized with Spotify.
- Support play, pause, seek, next, previous, and volume.
- Show buffering and reconnecting states.
- Recover gracefully after sleep, wake, network loss, or token refresh.
- Never fake a successful playback state.

---

### 3. Spotify Connect and device transfer

The app must register as a Spotify Connect player when possible.

Requirements:

- Once ready, the Mac should appear as `Aura Player — Mac` in Spotify's Available Devices list.
- Show the current device name and connection state in the app.
- Add a device picker using Spotify's available-devices endpoint.
- Allow playback to be transferred to this Mac.
- Allow transfer to another available Spotify device.
- Clearly explain when:
  - the user lacks Premium,
  - no active device exists,
  - the browser SDK is unavailable,
  - or Spotify refuses a transfer.
- Do not repeatedly force-transfer playback without the user's action.

---

### 4. Now-playing experience

The primary screen should be a full-window art display.

Show:

- Large, high-resolution album artwork.
- Song title.
- Artist name.
- Album name.
- Playback progress.
- Current time and duration.
- Play/pause.
- Previous and next.
- Volume.
- Device indicator.
- Lyrics.
- Subtle connection status.
- A small button to reveal the library/search interface.

Behavior:

- Double-click album art to enter or leave fullscreen.
- Hide most controls after several seconds of inactivity.
- Reveal controls smoothly when the pointer moves.
- Support keyboard controls:
  - Space: play/pause
  - Left/right arrows: seek
  - Command-left/right: previous/next
  - F: fullscreen
  - L: toggle lyrics
  - Escape: close overlays or leave fullscreen

---

### 5. Procedural visual engine

The app must generate its own animation in real time instead of relying on pre-rendered video backgrounds.

Build a `VisualEngine` abstraction:

```ts
export interface VisualEngine {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  setTrack(context: VisualTrackContext): Promise<void>;
  setPlaybackState(state: PlayerState): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setIntensity(value: number): void;
  destroy(): void;
}
```

The visual engine should:

- Analyze the album artwork locally.
- Extract dominant, accent, shadow, and highlight colors.
- Generate animated gradients, light fields, blur layers, particles, grain, glow, and subtle depth.
- React to playback progress, play/pause state, track transitions, and seek events.
- Use deterministic seeds derived from the track ID so each song has a recognizable visual identity.
- Create smooth transitions between songs.
- Run without uploading artwork to an external service.
- Render with Canvas 2D or WebGL.
- Fall back to a low-power Canvas 2D mode on older Intel Macs.
- Pause or reduce animation when the window is hidden or playback is paused.
- Respect Reduce Motion.
- Never depend on Spotify audio capture or audio-stream inspection.

Optional visual modes:

- `Aurora`: slow flowing color fields.
- `Bloom`: expanding soft light forms.
- `Orbit`: artwork-derived particles moving in arcs.
- `Glass`: refracted translucent panes.
- `Ink`: fluid procedural shapes.
- `Minimal`: subtle gradient and grain only.

The visual direction is **editorial, cinematic, soft, and luxurious**.

Do not copy Spotify's interface exactly. Create an original experience.

Use album artwork to generate the visual environment:

- Extract a restrained color palette from the cover.
- Render a blurred, enlarged artwork layer as the background.
- Apply a dark translucent gradient for contrast.
- Add subtle grain or texture.
- Animate background colors slowly when the track changes.
- Add gentle artwork depth or parallax.
- Keep text readable in bright and dark artwork conditions.

Default layout:

- Artwork on the left at roughly 42% of the window width.
- Lyrics on the right at roughly 58%.
- Current lyric line large and sharply focused.
- Previous and next lines smaller and dimmer.
- Track information aligned cleanly near the artwork.
- Progress bar along the lower edge.

Animation rules:

- Prefer opacity, blur, and transform animations.
- Avoid flashy equalizers and excessive bouncing.
- Respect macOS Reduce Motion.
- Keep transitions smooth at 60 FPS on older Intel Macs.
- Crossfade artwork and palette changes rather than cutting abruptly.

---

### 6. Lyrics system

Create a provider-independent lyrics architecture.

```ts
export interface LyricsProvider {
  findLyrics(track: TrackIdentity): Promise<LyricsResult | null>;
}

export interface TrackIdentity {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  isrc?: string;
}
```

Support these result types:

```ts
export type LyricsResult =
  | {
      kind: "synced";
      source: string;
      lines: Array<{
        startMs: number;
        endMs?: number;
        text: string;
      }>;
    }
  | {
      kind: "plain";
      source: string;
      text: string;
    };
```

Initial providers:

1. `LocalLrcProvider`
   - Let users import `.lrc` files.
   - Match by Spotify track ID, ISRC, or normalized artist/title.
   - Parse standard timestamp formats.
   - Store only user-imported lyric files and matching metadata.

2. `LicensedLyricsProvider`
   - Create the adapter and settings UI.
   - Leave provider credentials unconfigured.
   - Document where a licensed API can be connected.

3. `AuthorizedScraperProvider`
   - Build a generic scraper adapter for websites the user owns or has permission to scrape.
   - Accept source-specific selectors and parsing rules through configuration.
   - Respect `robots.txt`, rate limits, crawl delays, and source terms.
   - Use a descriptive user agent.
   - Cache only the minimum metadata needed.
   - Add exponential backoff and strict concurrency limits.
   - Never bypass access controls, CAPTCHAs, authentication, or anti-bot protections.
   - Disable the provider by default until the user configures an authorized source.
   - Keep every source adapter isolated so it can be removed without changing the lyrics UI.

Example configuration shape:

```ts
export interface AuthorizedLyricsSource {
  id: string;
  baseUrl: string;
  searchUrlTemplate: string;
  resultLinkSelector: string;
  lyricsSelector: string;
  titleSelector?: string;
  artistSelector?: string;
  requestsPerMinute: number;
  userAgent: string;
}
```

Lyrics behavior:

- Highlight the active line based on playback position.
- Scroll smoothly so the active line remains near center.
- Permit a user-adjustable synchronization offset.
- Show instrumental sections elegantly.
- Show a tasteful empty state when lyrics are unavailable.
- Never invent lyric text.
- Do not bundle copyrighted lyrics in tests or fixtures.
- Use original placeholder text in development data.

---

### 7. Library and search

Create a secondary panel or modal that supports:

- Spotify track search.
- Recently played content when the required endpoint and access mode permit it.
- Saved tracks.
- User playlists.
- Playlist track browsing.
- Clicking a track to start playback.
- Right-click or overflow action to queue, play next, or open in Spotify where supported.

The now-playing art display remains the app's central experience. Library screens should feel lightweight and secondary.

---

### 8. Menu-bar controls

Add an optional macOS menu-bar icon.

Menu items:

- Current track title and artist.
- Play/pause.
- Previous.
- Next.
- Show Aura Player.
- Enter fullscreen.
- Quit.

The tray/menu-bar feature must be optional in Settings.

---

### 9. Settings

Include:

- Spotify account status.
- Device name.
- Fullscreen on launch.
- Launch at login.
- Hide controls automatically.
- Show lyrics by default.
- Lyric synchronization offset.
- Visual motion intensity.
- Background blur intensity.
- Artwork scale.
- Optional menu-bar control.
- Imported `.lrc` file management.
- Clear cache.
- Sign out.

Persist non-sensitive settings locally. Store authentication tokens only in Keychain.

---

## Security Requirements

Use safe Electron defaults:

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: PRELOAD_PATH
  }
});
```

Additional requirements:

- Expose only a narrow typed API through the preload script.
- Validate every IPC payload with Zod.
- Use a restrictive Content Security Policy.
- Block unexpected navigation.
- Open approved external URLs in the system browser.
- Restrict callback handling to the expected local address and path.
- Validate OAuth state and callback parameters.
- Sanitize imported filenames and file paths.
- Never render remote HTML.
- Never place secrets in renderer code.
- Do not disable Electron security warnings.
- Document any exception that weakens sandboxing.

---

## Accessibility

- Meet WCAG AA contrast where practical.
- Add keyboard navigation to every control.
- Add accessible labels to icon buttons.
- Make focus rings visible.
- Support Reduce Motion.
- Support Dynamic Type-like scaling through an app text-size setting.
- Ensure lyrics remain readable at a distance.
- Do not encode status using color alone.

---

## Performance

- Lazy-load secondary panels.
- Debounce palette extraction.
- Cache artwork responsibly.
- Limit artwork cache size.
- Avoid recomputing dominant colors on every render.
- Avoid unbounded event listeners.
- Unsubscribe cleanly on component unmount.
- Test on an Intel Mac or use conservative performance assumptions.
- Keep idle CPU usage low while music is paused.
- Do not animate hidden windows.

---

## Error States

Create polished, human-readable states for:

- Spotify login cancelled.
- Expired login.
- Premium required.
- Playback SDK unavailable.
- DRM/playback initialization failure.
- No active device.
- Device transfer rejected.
- Network offline.
- Spotify rate limit.
- Track unavailable.
- Lyrics unavailable.
- Invalid `.lrc` file.
- Keychain access failure.

Each state should include a useful next action rather than only an error code.

---

## Development Sequence

Implement in this order:

### Phase 1: Foundation

- Scaffold Electron + React + TypeScript + Vite.
- Configure secure main/preload/renderer boundaries.
- Add Tailwind, Zustand, TanStack Query, Zod, Vitest, and Playwright.
- Add linting and formatting.
- Add a basic macOS 11-compatible window.

### Phase 2: Authentication

- Implement PKCE generation.
- Implement browser login.
- Implement callback handling.
- Store and refresh tokens securely.
- Build login and sign-out screens.

### Phase 3: Playback

- Implement the playback-service interface.
- Integrate Spotify's Web Playback SDK.
- Register the device.
- Add controls and player-state synchronization.
- Confirm whether the packaged runtime supports required playback/DRM behavior.
- If it does not, stop and document the exact blocker before choosing an alternative.

### Phase 4: Now Playing and procedural animation

- Build the artwork-first interface.
- Add metadata and controls.
- Add fullscreen and auto-hide behavior.
- Implement the procedural `VisualEngine`.
- Add local artwork palette extraction.
- Add deterministic per-track animation seeds.
- Add cinematic background transitions.
- Add Canvas 2D fallback and low-power mode.

### Phase 5: Lyrics

- Build `.lrc` import and parser.
- Match lyric files to tracks.
- Add synchronized scrolling and offset controls.
- Add the licensed-provider adapter interface.
- Add the disabled-by-default authorized scraper adapter.
- Add source configuration validation, rate limiting, caching, and robots compliance.

### Phase 6: Devices and Library

- Add available-devices UI.
- Add playback transfer.
- Add search, playlists, and saved tracks.
- Add clear loading, empty, and error states.

### Phase 7: Polish

- Add menu-bar controls.
- Add settings.
- Add accessibility.
- Add sleep/wake recovery.
- Optimize performance.
- Package Intel and Apple Silicon builds where supported.

---

## Testing Requirements

Write meaningful tests rather than placeholder tests.

Unit tests:

- PKCE generation.
- OAuth state validation.
- Token expiration calculations.
- Spotify API error mapping.
- LRC parsing.
- Lyrics normalization and matching.
- Active lyric line selection.
- Playback reducer/store behavior.
- Settings validation.
- IPC schema validation.

End-to-end tests:

- Logged-out launch.
- OAuth callback simulation.
- Now-playing screen with mocked Spotify state.
- Playback control interaction.
- Track change animation.
- Lyrics import.
- Lyrics synchronization.
- Device picker.
- Offline state.
- Fullscreen behavior.
- Keyboard shortcuts.
- Settings persistence.

Do not make tests depend on a real Spotify account. Put live Spotify verification behind an explicit manual test process.

---

## Manual Spotify Verification Checklist

Document how the developer can verify:

- Login works with a Spotify developer application.
- Tokens refresh after expiration.
- The player becomes ready.
- `Aura Player — Mac` appears in Available Devices.
- Playback can transfer from a phone to the Mac.
- Playback can transfer from the Mac to another device.
- Play, pause, seek, next, previous, and volume work.
- Sleep and wake recovery works.
- Playback resumes after network interruption.
- A non-Premium account receives a clear explanation.
- Rate limiting is handled without retry loops.

---

## Required Documentation

Create a thorough `README.md` containing:

- Product overview.
- Screenshots section with placeholders.
- Prerequisites.
- Spotify developer dashboard setup.
- Exact redirect URI.
- Environment setup.
- Install and run commands.
- Build commands.
- macOS 11 compatibility notes.
- Spotify Premium requirement.
- Spotify development-mode limitations.
- Lyrics-provider limitations.
- Security architecture.
- Troubleshooting.
- Manual Spotify test checklist.
- Packaging instructions.
- Known limitations.

Create an `AGENTS.md` containing:

- Architecture summary.
- Coding conventions.
- Folder ownership.
- Commands to run after changes.
- Security invariants.
- Spotify policy constraints.
- Definition of done.

---

## Commands

The completed project should support:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run package:mac
```

---

## Definition of Done

The app is complete when:

- It launches on macOS 11.
- Spotify sign-in works securely.
- Tokens survive app restarts through Keychain storage.
- The app registers as a Spotify Connect device when supported.
- It appears in Available Devices on the user's phone.
- Playback can be transferred to the Mac.
- Playback controls work.
- Album art and metadata update correctly.
- The visual display is polished and responsive.
- Synced local lyrics work.
- Missing lyrics are handled honestly and elegantly.
- The app survives sleep/wake and temporary network loss.
- Security settings remain enabled.
- Tests, linting, and type checking pass.
- A signed distributable can be produced after the developer supplies Apple signing credentials.
- Documentation explains every required setup step.

---

## Instructions to Codex

1. Inspect the repository before editing.
2. If the repository is empty, scaffold the project described above.
3. Work through the development phases in order.
4. Do not claim a Spotify feature works until it has been implemented and verified.
5. Prefer production-quality code over mock-only screens.
6. Keep secrets out of source control.
7. Use typed interfaces at every external boundary.
8. Run lint, typecheck, and tests after meaningful changes.
9. Fix errors rather than suppressing them.
10. Keep a running checklist in `README.md` or `TASKS.md`.
11. Preserve macOS 11 compatibility.
12. Stop and clearly document any Spotify DRM limitation that prevents packaged playback.
13. Implement only permission-based scraper adapters; do not target prohibited sources or bypass protections.
14. Generate the visual animations procedurally inside the app.
15. Do not copy Spotify's visual design exactly.
16. Deliver a complete, runnable repository rather than isolated snippets.

Begin by creating the project foundation and authentication flow. Then proceed through playback, the visual now-playing interface, lyrics, device transfer, library features, testing, and packaging.
