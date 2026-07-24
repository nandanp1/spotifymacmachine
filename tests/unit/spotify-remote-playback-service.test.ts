import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SpotifyApiError,
  type SpotifyDevice,
  type SpotifyPlaybackSnapshot,
} from "../../src/renderer/features/devices/spotify-api";
import {
  SpotifyRemotePlaybackService,
  type RemotePlaybackEnvironment,
  type SpotifyRemotePlaybackApi,
} from "../../src/renderer/features/player/spotify-remote-playback-service";

const device: SpotifyDevice = {
  id: "remote-device-1",
  isActive: true,
  isPrivateSession: false,
  isRestricted: false,
  name: "Bedroom Speaker",
  type: "Speaker",
  volumePercent: 42,
  supportsVolume: true,
};

const snapshot: SpotifyPlaybackSnapshot = {
  device,
  track: {
    id: "track-1",
    uri: "spotify:track:track1",
    title: "Borrowed Light",
    artists: ["Aura Test Ensemble"],
    album: {
      name: "Original Fixtures",
      uri: "spotify:album:album1",
      images: [
        {
          url: "https://images.example.test/cover.jpg",
          width: 640,
          height: 640,
        },
      ],
    },
    durationMs: 180_000,
    isPlayable: true,
  },
  itemType: "track",
  isPlaying: true,
  progressMs: 12_500,
  contextUri: "spotify:album:album1",
  repeatMode: "context",
  shuffle: true,
  restrictions: {
    pausing: false,
    resuming: false,
    seeking: false,
    skippingNext: false,
    skippingPrevious: false,
  },
  timestamp: 1_000,
};

class FakeEnvironment implements RemotePlaybackEnvironment {
  online = true;
  visible = true;
  private readonly networkListeners = new Set<() => void>();
  private readonly visibilityListeners = new Set<() => void>();

  isOnline(): boolean {
    return this.online;
  }

  isVisible(): boolean {
    return this.visible;
  }

  subscribeNetwork(listener: () => void): () => void {
    this.networkListeners.add(listener);
    return () => {
      this.networkListeners.delete(listener);
    };
  }

  subscribeVisibility(listener: () => void): () => void {
    this.visibilityListeners.add(listener);
    return () => {
      this.visibilityListeners.delete(listener);
    };
  }

  setOnline(online: boolean): void {
    this.online = online;
    this.networkListeners.forEach((listener) => listener());
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.visibilityListeners.forEach((listener) => listener());
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function createApi(
  overrides: Partial<SpotifyRemotePlaybackApi> = {},
): SpotifyRemotePlaybackApi {
  return {
    getAvailableDevices: vi.fn(async () => [device]),
    getCurrentPlayback: vi.fn(async () => snapshot),
    startPlayback: vi.fn(async () => undefined),
    resumePlayback: vi.fn(async () => undefined),
    pausePlayback: vi.fn(async () => undefined),
    skipToNext: vi.fn(async () => undefined),
    skipToPrevious: vi.fn(async () => undefined),
    seekPlayback: vi.fn(async () => undefined),
    setPlaybackVolume: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createService(
  api: SpotifyRemotePlaybackApi,
  environment = new FakeEnvironment(),
  targetOverrides: Partial<typeof device> = {},
): SpotifyRemotePlaybackService {
  return new SpotifyRemotePlaybackService({
    api,
    environment,
    pollIntervalMs: 250,
    target: {
      id: targetOverrides.id ?? device.id ?? "",
      name: targetOverrides.name ?? device.name,
      isRestricted:
        targetOverrides.isRestricted ?? device.isRestricted,
      supportsVolume:
        targetOverrides.supportsVolume ?? device.supportsVolume,
      volumePercent:
        targetOverrides.volumePercent ?? device.volumePercent,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SpotifyRemotePlaybackService", () => {
  it("verifies the selected device and maps remote playback state", async () => {
    const api = createApi();
    const service = createService(api);
    const stateListener = vi.fn();
    service.subscribe(stateListener);

    await service.connect();

    expect(service.getStatus()).toEqual({
      phase: "ready",
      deviceId: "remote-device-1",
      deviceName: "Bedroom Speaker",
      problem: null,
    });
    expect(service.getTarget()).toEqual({
      id: "remote-device-1",
      name: "Bedroom Speaker",
      isRestricted: false,
      supportsVolume: true,
      volumePercent: 42,
    });
    await expect(service.getState()).resolves.toEqual({
      source: "spotify",
      track: {
        id: "track-1",
        uri: "spotify:track:track1",
        title: "Borrowed Light",
        artists: ["Aura Test Ensemble"],
        album: "Original Fixtures",
        albumUri: "spotify:album:album1",
        durationMs: 180_000,
        artwork: [
          {
            url: "https://images.example.test/cover.jpg",
            width: 640,
            height: 640,
          },
        ],
        isPlayable: true,
      },
      paused: false,
      buffering: false,
      positionMs: 12_500,
      durationMs: 180_000,
      volume: 0.42,
      deviceId: "remote-device-1",
      contextUri: "spotify:album:album1",
      repeatMode: "context",
      shuffle: true,
      restrictions: snapshot.restrictions,
      observedAt: Date.now(),
    });
    expect(stateListener).toHaveBeenCalledOnce();
    expect(api.getAvailableDevices).toHaveBeenCalledOnce();
    expect(api.getCurrentPlayback).toHaveBeenCalledOnce();
  });

  it.each([
    [
      [],
      { ...device },
      "no-device",
    ],
    [
      [{ ...device, isActive: false }],
      { ...device },
      "no-device",
    ],
    [
      [{ ...device, isRestricted: true }],
      { ...device },
      "no-device",
    ],
  ])(
    "refuses a missing, inactive, or restricted target",
    async (devices, target, expectedCode) => {
      const api = createApi({
        getAvailableDevices: vi.fn(async () => devices),
      });
      const service = createService(api, new FakeEnvironment(), target);

      await expect(service.connect()).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(service.getStatus()).toMatchObject({
        phase: "unavailable",
        deviceId: null,
        problem: { code: expectedCode },
      });
      expect(service.getTarget()).toBeNull();
      expect(api.getCurrentPlayback).not.toHaveBeenCalled();
    },
  );

  it("targets every command at the selected device and refreshes honestly", async () => {
    const api = createApi();
    const service = createService(api);
    await service.connect();
    vi.mocked(api.getCurrentPlayback).mockClear();

    await service.play("spotify:track:another1");
    await service.play();
    await service.pause();
    await service.next();
    await service.previous();
    await service.seek(999_000);
    await service.setVolume(0.416);

    expect(api.startPlayback).toHaveBeenCalledWith({
      uri: "spotify:track:another1",
      deviceId: "remote-device-1",
      signal: expect.any(AbortSignal),
    });
    expect(api.resumePlayback).toHaveBeenCalledWith(
      "remote-device-1",
      expect.any(AbortSignal),
    );
    expect(api.pausePlayback).toHaveBeenCalledWith(
      "remote-device-1",
      expect.any(AbortSignal),
    );
    expect(api.skipToNext).toHaveBeenCalledWith(
      "remote-device-1",
      expect.any(AbortSignal),
    );
    expect(api.skipToPrevious).toHaveBeenCalledWith(
      "remote-device-1",
      expect.any(AbortSignal),
    );
    expect(api.seekPlayback).toHaveBeenCalledWith(
      "remote-device-1",
      180_000,
      expect.any(AbortSignal),
    );
    expect(api.setPlaybackVolume).toHaveBeenCalledWith(
      "remote-device-1",
      42,
      expect.any(AbortSignal),
    );
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(14);
  });

  it("serializes concurrent commands in call order", async () => {
    const firstCommand = createDeferred<void>();
    const commandOrder: string[] = [];
    const api = createApi({
      pausePlayback: vi.fn(() => {
        commandOrder.push("pause");
        return firstCommand.promise;
      }),
      skipToNext: vi.fn(async () => {
        commandOrder.push("next");
      }),
    });
    const service = createService(api);
    await service.connect();

    const pause = service.pause();
    const next = service.next();
    await flushMicrotasks();

    expect(commandOrder).toEqual(["pause"]);
    firstCommand.resolve();
    await expect(Promise.all([pause, next])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(commandOrder).toEqual(["pause", "next"]);
  });

  it("drops queued commands captured before a lifecycle change", async () => {
    const firstCommand = createDeferred<void>();
    const api = createApi({
      pausePlayback: vi.fn(() => firstCommand.promise),
    });
    const service = createService(api);
    await service.connect();

    const pause = service.pause();
    await flushMicrotasks();
    expect(api.pausePlayback).toHaveBeenCalledOnce();

    const next = service.next();
    await flushMicrotasks();
    expect(api.skipToNext).not.toHaveBeenCalled();

    await service.disconnect();
    await service.connect();
    const pauseRejection = expect(pause).rejects.toMatchObject({
      name: "AbortError",
    });
    const nextRejection = expect(next).rejects.toMatchObject({
      name: "AbortError",
    });
    firstCommand.resolve();

    await pauseRejection;
    await nextRejection;
    expect(api.skipToNext).not.toHaveBeenCalled();
  });

  it("preflights the active target before sending a mutation", async () => {
    const api = createApi();
    const service = createService(api);
    await service.connect();
    vi.mocked(api.getCurrentPlayback).mockResolvedValueOnce({
      ...snapshot,
      device: {
        ...device,
        id: "other-device",
        name: "Phone",
      },
    });

    await expect(service.pause()).rejects.toMatchObject({
      code: "no-device",
      message: expect.stringContaining("moved"),
    });
    expect(api.pausePlayback).not.toHaveBeenCalled();
    expect(service.getTarget()).toBeNull();
  });

  it.each([
    ["pause", "pausing", "pausePlayback"],
    ["play", "resuming", "resumePlayback"],
    ["seek", "seeking", "seekPlayback"],
    ["next", "skippingNext", "skipToNext"],
    ["previous", "skippingPrevious", "skipToPrevious"],
  ] as const)(
    "enforces the fresh %s action restriction",
    async (action, restriction, apiMethod) => {
      const api = createApi();
      const service = createService(api);
      await service.connect();
      vi.mocked(api.getCurrentPlayback).mockResolvedValueOnce({
        ...snapshot,
        restrictions: {
          ...snapshot.restrictions,
          [restriction]: true,
        },
      });

      const operation =
        action === "pause"
          ? service.pause()
          : action === "play"
            ? service.play()
            : action === "seek"
              ? service.seek(10_000)
              : action === "next"
                ? service.next()
                : service.previous();

      await expect(operation).rejects.toMatchObject({
        code: "playback",
        message: expect.stringContaining("does not allow"),
      });
      expect(api[apiMethod]).not.toHaveBeenCalled();
    },
  );

  it("allows an explicit new track despite a resume restriction", async () => {
    const api = createApi();
    const service = createService(api);
    await service.connect();
    vi.mocked(api.getCurrentPlayback)
      .mockResolvedValueOnce({
        ...snapshot,
        restrictions: {
          ...snapshot.restrictions,
          resuming: true,
        },
      })
      .mockResolvedValueOnce(snapshot);

    await expect(
      service.play("spotify:track:another1"),
    ).resolves.toBeUndefined();
    expect(api.startPlayback).toHaveBeenCalledOnce();
    expect(api.resumePlayback).not.toHaveBeenCalled();
  });

  it("does not call Spotify volume for an unsupported target", async () => {
    const unsupportedDevice = {
      ...device,
      supportsVolume: false,
    };
    const api = createApi({
      getAvailableDevices: vi.fn(async () => [unsupportedDevice]),
      getCurrentPlayback: vi.fn(async () => ({
        ...snapshot,
        device: unsupportedDevice,
      })),
    });
    const service = createService(
      api,
      new FakeEnvironment(),
      unsupportedDevice,
    );
    await service.connect();

    await expect(service.setVolume(0.5)).rejects.toMatchObject({
      code: "playback",
      message: expect.stringContaining("does not support"),
    });
    expect(api.setPlaybackVolume).not.toHaveBeenCalled();
  });

  it("pauses polling while hidden or offline and cleans up on disconnect", async () => {
    const environment = new FakeEnvironment();
    const api = createApi();
    const service = createService(api, environment);
    await service.connect();
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(1);

    environment.setVisible(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(1);

    environment.setVisible(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(2);

    environment.setOnline(false);
    expect(service.getStatus()).toMatchObject({
      phase: "offline",
      problem: { code: "network" },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(2);

    environment.setOnline(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(3);

    await service.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(3);
    expect(service.getStatus().phase).toBe("idle");
    await expect(service.getState()).resolves.toBeNull();
  });

  it("invalidates a target when playback moves and freezes the last state", async () => {
    const api = createApi();
    const service = createService(api);
    await service.connect();
    const lastState = await service.getState();
    vi.mocked(api.getCurrentPlayback).mockResolvedValueOnce({
      ...snapshot,
      device: {
        ...device,
        id: "other-device",
        name: "Phone",
      },
    });

    await vi.advanceTimersByTimeAsync(250);

    expect(service.getTarget()).toBeNull();
    expect(service.getStatus()).toMatchObject({
      phase: "unavailable",
      deviceId: null,
      problem: { code: "no-device" },
    });
    await expect(service.getState()).resolves.toBe(lastState);
  });

  it("respects Retry-After before polling again", async () => {
    const api = createApi();
    const service = createService(api);
    await service.connect();
    vi.mocked(api.getCurrentPlayback)
      .mockRejectedValueOnce(
        new SpotifyApiError({
          code: "rate-limited",
          message: "Slow down",
          action: "Try again in 2 seconds.",
          status: 429,
          retryAfterSeconds: 2,
        }),
      )
      .mockResolvedValueOnce(snapshot);

    await vi.advanceTimersByTimeAsync(250);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toMatchObject({
      phase: "reconnecting",
      problem: { code: "rate-limited" },
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(3);
    expect(service.getStatus().phase).toBe("ready");
  });

  it("reschedules polling after a command-side rate limit", async () => {
    const environment = new FakeEnvironment();
    const api = createApi();
    const service = createService(api, environment);
    await service.connect();
    vi.mocked(api.pausePlayback).mockRejectedValueOnce(
      new SpotifyApiError({
        code: "rate-limited",
        message: "Slow down",
        action: "Try again in 2 seconds.",
        status: 429,
        retryAfterSeconds: 2,
      }),
    );

    await expect(service.pause()).rejects.toMatchObject({
      code: "rate-limited",
    });
    const callsAfterCommand = vi.mocked(api.getCurrentPlayback).mock.calls
      .length;
    expect(service.getStatus()).toMatchObject({
      phase: "reconnecting",
      problem: { code: "rate-limited" },
    });

    environment.setVisible(false);
    environment.setVisible(true);
    environment.setOnline(false);
    environment.setOnline(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(
      callsAfterCommand,
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(
      callsAfterCommand + 1,
    );
  });

  it("stops automatic work after Spotify reports quota exhaustion", async () => {
    const environment = new FakeEnvironment();
    const api = createApi();
    const service = createService(api, environment);
    await service.connect();
    vi.mocked(api.pausePlayback).mockRejectedValueOnce(
      new SpotifyApiError({
        code: "quota-exceeded",
        message: "Application request quota exceeded",
        action: "Wait for Spotify's application quota to reset.",
        status: 429,
        reason: "QUOTA_EXCEEDED",
      }),
    );

    await expect(service.pause()).rejects.toMatchObject({
      code: "rate-limited",
      recoverable: false,
      action: expect.stringContaining("quota to reset"),
    });
    const callsAfterFailure = vi.mocked(api.getCurrentPlayback).mock.calls
      .length;
    expect(service.getStatus()).toMatchObject({
      phase: "error",
      problem: {
        code: "rate-limited",
        recoverable: false,
      },
    });

    environment.setVisible(false);
    environment.setVisible(true);
    environment.setOnline(false);
    environment.setOnline(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(api.getCurrentPlayback).toHaveBeenCalledTimes(
      callsAfterFailure,
    );
    expect(api.pausePlayback).toHaveBeenCalledOnce();
    expect(service.getStatus().phase).toBe("error");
  });

  it("publishes ready before delivering a recovery snapshot", async () => {
    const environment = new FakeEnvironment();
    const api = createApi();
    const service = createService(api, environment);
    await service.connect();
    const events: string[] = [];
    service.subscribeStatus((status) => {
      events.push(`status:${status.phase}`);
    });
    service.subscribe((state) => {
      events.push(`state:${state?.positionMs ?? "none"}`);
    });
    vi.mocked(api.getCurrentPlayback).mockResolvedValueOnce({
      ...snapshot,
      progressMs: 44_000,
    });

    environment.setOnline(false);
    events.length = 0;
    environment.setOnline(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      "status:reconnecting",
      "status:ready",
      "state:44000",
    ]);
  });

  it("suppresses a stale connect response after disconnect", async () => {
    let resolvePlayback: (
      value: SpotifyPlaybackSnapshot | null,
    ) => void = () => undefined;
    const playback = new Promise<SpotifyPlaybackSnapshot | null>(
      (resolve) => {
        resolvePlayback = resolve;
      },
    );
    const api = createApi({
      getCurrentPlayback: vi.fn(() => playback),
    });
    const service = createService(api);
    const connecting = service.connect();
    const rejection = expect(connecting).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(api.getCurrentPlayback).toHaveBeenCalledOnce();

    await service.disconnect();
    resolvePlayback(snapshot);

    await rejection;
    expect(service.getStatus().phase).toBe("idle");
    await expect(service.getState()).resolves.toBeNull();
  });
});
