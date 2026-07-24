import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampPosition,
  clampVolume,
  estimatePlaybackPosition,
  type ObservablePlaybackService,
  type PlaybackServiceStatus,
  type PlaybackService,
  type PlayerState,
} from "../../src/renderer/features/player/playback-service";
import {
  getEstimatedAuraPosition,
  playerStore,
  type AuraTrack,
} from "../../src/renderer/stores/player-store";

const demoTrack: AuraTrack = {
  id: "demo-original",
  uri: "aura:demo:original",
  title: "Original Demo",
  artist: "Aura Test Ensemble",
  artists: ["Aura Test Ensemble"],
  album: "Original Fixtures",
  artworkUrl: null,
  durationMs: 60_000,
  source: "demo",
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  await playerStore.disconnect();
});

afterEach(async () => {
  await playerStore.disconnect();
  vi.useRealTimers();
});

describe("player store demo transitions", () => {
  it("marks demo provenance explicitly and bounds initial values", () => {
    playerStore.setDemoTrack(demoTrack, {
      paused: true,
      positionMs: 75_000,
      volume: 2,
      deviceName: "Local visual preview",
    });

    expect(playerStore.getState()).toMatchObject({
      source: "demo",
      connectionPhase: "demo",
      track: {
        id: "demo-original",
        source: "demo",
      },
      paused: true,
      isPlaying: false,
      buffering: false,
      positionMs: 60_000,
      durationMs: 60_000,
      volume: 1,
      deviceId: null,
      deviceName: "Local visual preview",
      problem: null,
    });
  });

  it("captures elapsed demo time on pause and supports bounded controls", async () => {
    playerStore.setDemoTrack(demoTrack, {
      positionMs: 10_000,
      volume: 0.5,
    });
    vi.advanceTimersByTime(2_500);

    expect(getEstimatedAuraPosition(playerStore.getState())).toBe(12_500);
    await playerStore.pause();
    expect(playerStore.getState()).toMatchObject({
      paused: true,
      isPlaying: false,
      positionMs: 12_500,
    });

    await playerStore.seek(Number.POSITIVE_INFINITY);
    expect(playerStore.getState().positionMs).toBe(0);
    await playerStore.seek(80_000);
    expect(playerStore.getState().positionMs).toBe(60_000);
    await playerStore.setVolume(-1);
    expect(playerStore.getState().volume).toBe(0);
    await playerStore.previous();
    expect(playerStore.getState().positionMs).toBe(0);

    await playerStore.togglePlayback();
    expect(playerStore.getState()).toMatchObject({
      paused: false,
      isPlaying: true,
    });
  });

  it("clears a demo back to an honest disconnected state", () => {
    playerStore.setDemoTrack(demoTrack);
    playerStore.clearDemo();

    expect(playerStore.getState()).toMatchObject({
      source: "none",
      connectionPhase: "idle",
      track: null,
      paused: true,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      deviceId: null,
      problem: null,
    });
  });

  it("disconnects Spotify and ignores stale playback when demo starts", async () => {
    const playbackListeners = new Set<
      (state: PlayerState | null) => void
    >();
    const disconnect = vi.fn(async () => undefined);
    const spotifyState: PlayerState = {
      source: "spotify",
      track: {
        id: "spotify-live",
        uri: "spotify:track:live",
        title: "Live Track",
        artists: ["Connected Artist"],
        album: "Connected Album",
        durationMs: 180_000,
        artwork: [],
      },
      paused: false,
      buffering: false,
      positionMs: 8_000,
      durationMs: 180_000,
      volume: 0.4,
      deviceId: "device-1",
      observedAt: Date.now(),
    };
    const service: PlaybackService = {
      connect: vi.fn(async () => undefined),
      disconnect,
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      next: vi.fn(async () => undefined),
      previous: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      getState: vi.fn(async () => spotifyState),
      subscribe: vi.fn((listener) => {
        playbackListeners.add(listener);
        return () => {
          playbackListeners.delete(listener);
        };
      }),
    };

    await playerStore.connect(service);
    expect(playerStore.getState().source).toBe("spotify");

    playerStore.setDemoTrack(demoTrack);
    await Promise.resolve();
    playbackListeners.forEach((listener) => listener(spotifyState));

    expect(disconnect).toHaveBeenCalledOnce();
    expect(playbackListeners.size).toBe(0);
    expect(playerStore.getState()).toMatchObject({
      source: "demo",
      track: { id: "demo-original", source: "demo" },
      deviceId: null,
    });
  });
});

describe("playback value helpers", () => {
  const state: PlayerState = {
    source: "demo",
    track: null,
    paused: false,
    buffering: false,
    positionMs: 5_000,
    durationMs: 10_000,
    volume: 0.5,
    deviceId: null,
    observedAt: 1_000,
  };

  it.each([
    [Number.NaN, 10_000, 0],
    [-100, 10_000, 0],
    [5_000, 10_000, 5_000],
    [15_000, 10_000, 10_000],
  ])(
    "clamps position %s against %s to %s",
    (position, duration, expected) => {
      expect(clampPosition(position, duration)).toBe(expected);
    },
  );

  it.each([
    [Number.NaN, 0],
    [-0.2, 0],
    [0.42, 0.42],
    [1.2, 1],
  ])("clamps volume %s to %s", (volume, expected) => {
    expect(clampVolume(volume)).toBe(expected);
  });

  it("estimates only active playback and never exceeds the duration", () => {
    expect(estimatePlaybackPosition(state, 4_000)).toBe(8_000);
    expect(estimatePlaybackPosition(state, 20_000)).toBe(10_000);
    expect(
      estimatePlaybackPosition({ ...state, paused: true }, 4_000),
    ).toBe(5_000);
    expect(
      estimatePlaybackPosition({ ...state, buffering: true }, 4_000),
    ).toBe(5_000);
    expect(estimatePlaybackPosition(state, 500)).toBe(5_000);
  });
});

describe("player store live connection honesty", () => {
  it("waits for ready and freezes an offline snapshot", async () => {
    const playbackListeners = new Set<
      (state: PlayerState | null) => void
    >();
    const statusListeners = new Set<
      (status: PlaybackServiceStatus) => void
    >();
    let status: PlaybackServiceStatus = {
      phase: "connecting",
      deviceId: "stale-before-ready",
      deviceName: "Aura Player — Mac",
      problem: null,
    };
    const spotifyState: PlayerState = {
      source: "spotify",
      track: {
        id: "live-track",
        uri: "spotify:track:live",
        title: "Live Track",
        artists: ["Live Artist"],
        album: "Live Album",
        durationMs: 180_000,
        artwork: [],
      },
      paused: false,
      buffering: false,
      positionMs: 1_000,
      durationMs: 180_000,
      volume: 0.5,
      deviceId: "fresh-device",
      restrictions: {
        pausing: true,
        seeking: true,
      },
      observedAt: Date.now(),
    };
    const service: ObservablePlaybackService = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      next: vi.fn(async () => undefined),
      previous: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      getState: vi.fn(async () => spotifyState),
      getStatus: () => status,
      subscribe: (listener) => {
        playbackListeners.add(listener);
        return () => {
          playbackListeners.delete(listener);
        };
      },
      subscribeStatus: (listener) => {
        statusListeners.add(listener);
        return () => {
          statusListeners.delete(listener);
        };
      },
    };
    const emitStatus = (next: PlaybackServiceStatus) => {
      status = next;
      statusListeners.forEach((listener) => listener(next));
    };

    await playerStore.connect(service);
    playbackListeners.forEach((listener) => listener(spotifyState));
    expect(playerStore.getState()).toMatchObject({
      connectionPhase: "connecting",
      track: null,
      isPlaying: false,
      deviceId: null,
    });

    emitStatus({
      ...status,
      phase: "ready",
      deviceId: "fresh-device",
    });
    playbackListeners.forEach((listener) => listener(spotifyState));
    expect(playerStore.getState()).toMatchObject({
      connectionPhase: "ready",
      track: { id: "live-track" },
      paused: false,
      isPlaying: true,
      buffering: false,
      positionMs: 1_000,
      deviceId: "fresh-device",
      restrictions: {
        pausing: true,
        seeking: true,
      },
    });

    vi.advanceTimersByTime(2_000);
    emitStatus({
      ...status,
      phase: "offline",
      deviceId: "stale-device",
      problem: {
        code: "network",
        message: "Offline",
        recoverable: true,
      },
    });
    expect(playerStore.getState()).toMatchObject({
      connectionPhase: "offline",
      paused: true,
      isPlaying: false,
      buffering: false,
      positionMs: 3_000,
      deviceId: null,
      restrictions: undefined,
    });

    vi.advanceTimersByTime(5_000);
    playbackListeners.forEach((listener) =>
      listener({ ...spotifyState, positionMs: 50_000 }),
    );
    expect(getEstimatedAuraPosition(playerStore.getState())).toBe(3_000);
    expect(playerStore.getState().track?.id).toBe("live-track");
  });
});
