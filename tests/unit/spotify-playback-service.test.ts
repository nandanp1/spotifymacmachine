// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerState } from "../../src/renderer/features/player/playback-service";
import { SpotifyPlaybackService } from "../../src/renderer/features/player/spotify-playback-service";

type SdkEvent =
  | "ready"
  | "not_ready"
  | "player_state_changed"
  | "initialization_error"
  | "authentication_error"
  | "account_error"
  | "playback_error";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

class FakeSpotifyPlayer {
  readonly connect = vi.fn(async () => true);
  readonly disconnect = vi.fn();
  readonly pause = vi.fn(async () => undefined);
  readonly resume = vi.fn(async () => undefined);
  readonly nextTrack = vi.fn(async () => undefined);
  readonly previousTrack = vi.fn(async () => undefined);
  readonly seek = vi.fn(async () => undefined);
  readonly setVolume = vi.fn(async () => undefined);
  readonly getCurrentState = vi.fn(async (): Promise<unknown> => null);
  readonly getVolume = vi.fn(async () => {
    const next = this.volumeResults.shift();
    return next ? next : 0.5;
  });
  readonly volumeResults: Array<number | Promise<number>> = [];
  private readonly listeners = new Map<
    SdkEvent,
    (payload: unknown) => void
  >();

  addListener(
    event: SdkEvent,
    listener: (payload: unknown) => void,
  ): boolean {
    this.listeners.set(event, listener);
    return true;
  }

  removeListener(event?: SdkEvent): boolean {
    if (event) {
      return this.listeners.delete(event);
    }
    this.listeners.clear();
    return true;
  }

  emit(event: SdkEvent, payload: unknown): void {
    this.listeners.get(event)?.(payload);
  }
}

let player: FakeSpotifyPlayer;
let service: SpotifyPlaybackService | null;
let now: number;

beforeEach(() => {
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  player = new FakeSpotifyPlayer();
  service = null;

  class PlayerConstructor {
    constructor() {
      return player;
    }
  }

  Object.defineProperty(window, "Spotify", {
    configurable: true,
    value: { Player: PlayerConstructor },
  });
});

afterEach(async () => {
  await service?.disconnect();
  service = null;
  delete window.Spotify;
  delete window.onSpotifyWebPlaybackSDKReady;
});

describe("Spotify playback connection recovery", () => {
  it("requires a fresh ready event and freezes offline playback", async () => {
    const states: Array<PlayerState | null> = [];
    service = createService();
    service.subscribe((state) => states.push(state));

    await service.connect();
    expect(service.getStatus()).toMatchObject({
      phase: "connecting",
      deviceId: null,
    });

    player.emit("ready", { device_id: "device-one" });
    await flushTasks();
    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      deviceId: "device-one",
    });

    player.emit("player_state_changed", makeSdkState("track-one", 1_000));
    await waitForState(states, "track-one");
    expect(states.at(-1)).toMatchObject({
      paused: false,
      buffering: false,
      positionMs: 1_000,
      deviceId: "device-one",
    });

    now += 1_000;
    player.emit("not_ready", { device_id: "device-one" });
    expect(service.getStatus()).toMatchObject({
      phase: "reconnecting",
      deviceId: null,
    });
    expect(states.at(-1)).toMatchObject({
      paused: true,
      buffering: false,
      positionMs: 2_000,
      deviceId: null,
    });

    player.emit("ready", { device_id: "device-one-returned" });
    player.emit("player_state_changed", makeSdkState("track-one", 4_000));
    await vi.waitFor(() => {
      expect(states.at(-1)).toMatchObject({
        positionMs: 4_000,
        deviceId: "device-one-returned",
      });
    });

    now += 1_000;
    window.dispatchEvent(new Event("offline"));
    expect(service.getStatus()).toMatchObject({
      phase: "offline",
      deviceId: null,
    });
    expect(states.at(-1)).toMatchObject({
      paused: true,
      buffering: false,
      positionMs: 5_000,
      deviceId: null,
      observedAt: now,
    });

    player.emit(
      "player_state_changed",
      makeSdkState("stale-offline-track", 50_000),
    );
    await flushTasks();
    expect(states.at(-1)?.track?.id).toBe("track-one");

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => {
      expect(player.connect).toHaveBeenCalledTimes(2);
    });
    expect(service.getStatus()).toMatchObject({
      phase: "reconnecting",
      deviceId: null,
    });

    await flushTasks();
    expect(service.getStatus().phase).toBe("reconnecting");
    player.emit("ready", { device_id: "device-two" });
    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      deviceId: "device-two",
    });
  });

  it("rejects malformed state and applies only the newest completed mapping", async () => {
    const states: Array<PlayerState | null> = [];
    service = createService();
    service.subscribe((state) => states.push(state));
    await service.connect();
    player.emit("ready", { device_id: "device-one" });
    await flushTasks();

    player.emit("player_state_changed", {
      paused: false,
      position: 100,
      duration: 1_000,
      track_window: {
        current_track: {
          id: "malformed",
          uri: "spotify:track:malformed",
          name: "Malformed",
        },
      },
    });
    await flushTasks();
    expect(states.at(-1) ?? null).toBeNull();

    const olderVolume = deferred<number>();
    const newerVolume = deferred<number>();
    player.volumeResults.push(olderVolume.promise, newerVolume.promise);
    player.emit("player_state_changed", makeSdkState("older", 1_000));
    player.emit("player_state_changed", makeSdkState("newer", 2_000));

    newerVolume.resolve(0.8);
    await waitForState(states, "newer");
    olderVolume.resolve(0.2);
    await flushTasks();
    expect(states.at(-1)).toMatchObject({
      track: { id: "newer" },
      volume: 0.8,
    });

    const rejectedVolume = deferred<number>();
    player.volumeResults.push(rejectedVolume.promise);
    player.emit("player_state_changed", makeSdkState("rejected", 3_000));
    rejectedVolume.reject(new Error("Volume read failed"));
    await flushTasks();
    expect(states.at(-1)?.track?.id).toBe("newer");

    const cancelledVolume = deferred<number>();
    player.volumeResults.push(cancelledVolume.promise);
    player.emit("player_state_changed", makeSdkState("cancelled", 4_000));
    player.emit("player_state_changed", null);
    expect(states.at(-1)).toBeNull();
    cancelledVolume.resolve(0.4);
    await flushTasks();
    expect(states.at(-1)).toBeNull();
  });
});

function createService(): SpotifyPlaybackService {
  return new SpotifyPlaybackService({
    getOAuthToken: async () => "test-token",
  });
}

function makeSdkState(id: string, position: number): Record<string, unknown> {
  return {
    paused: false,
    loading: false,
    position,
    duration: 180_000,
    repeat_mode: 0,
    shuffle: false,
    context: { uri: "spotify:playlist:context" },
    disallows: {
      pausing: false,
      resuming: false,
      seeking: false,
      skipping_next: false,
      skipping_prev: false,
    },
    track_window: {
      current_track: {
        id,
        uri: `spotify:track:${id}`,
        name: `Track ${id}`,
        duration_ms: 180_000,
        artists: [{ name: "Test Artist" }],
        album: {
          name: "Test Album",
          uri: "spotify:album:test",
          images: [
            {
              url: "https://i.scdn.co/image/test",
              width: 640,
              height: 640,
            },
          ],
        },
      },
    },
  };
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForState(
  states: Array<PlayerState | null>,
  trackId: string,
): Promise<void> {
  await vi.waitFor(() => {
    expect(states.at(-1)?.track?.id).toBe(trackId);
  });
}
