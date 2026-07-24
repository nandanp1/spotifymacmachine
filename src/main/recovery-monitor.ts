import { net, powerMonitor } from "electron";

import type {
  RecoverySignal,
  RecoveryState,
  Unsubscribe,
} from "../shared/types";

const NETWORK_POLL_INTERVAL_MS = 5_000;

/**
 * Main-process ownership keeps native power state and Chromium's network
 * status out of the sandboxed renderer. `net.isOnline()` is deliberately
 * treated as reachability only: true does not promise Spotify is reachable.
 */
export class RecoveryMonitor {
  private readonly listeners = new Set<
    (signal: RecoverySignal) => void
  >();
  private suspended = false;
  private screenLocked = false;
  private online = true;
  private observedAt = Date.now();
  private networkTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.online = net.isOnline();
    this.observedAt = Date.now();

    powerMonitor.on("suspend", this.handleSuspend);
    powerMonitor.on("resume", this.handleResume);
    powerMonitor.on("lock-screen", this.handleLockScreen);
    powerMonitor.on("unlock-screen", this.handleUnlockScreen);

    this.networkTimer = setInterval(
      this.observeNetwork,
      NETWORK_POLL_INTERVAL_MS,
    );
    this.networkTimer.unref();
  }

  getState(): RecoveryState {
    this.observeNetwork();
    this.observedAt = Date.now();
    return this.snapshot();
  }

  subscribe(listener: (signal: RecoverySignal) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.started) {
      this.started = false;
      powerMonitor.removeListener("suspend", this.handleSuspend);
      powerMonitor.removeListener("resume", this.handleResume);
      powerMonitor.removeListener("lock-screen", this.handleLockScreen);
      powerMonitor.removeListener("unlock-screen", this.handleUnlockScreen);

      if (this.networkTimer !== null) {
        clearInterval(this.networkTimer);
        this.networkTimer = null;
      }
    }
    this.listeners.clear();
  }

  private readonly handleSuspend = (): void => {
    this.suspended = true;
    this.emitPowerSignal("suspend");
  };

  private readonly handleResume = (): void => {
    this.suspended = false;
    this.observeNetwork();
    this.emitPowerSignal("resume");
  };

  private readonly handleLockScreen = (): void => {
    this.screenLocked = true;
    this.emitPowerSignal("lock-screen");
  };

  private readonly handleUnlockScreen = (): void => {
    this.screenLocked = false;
    this.observeNetwork();
    this.emitPowerSignal("unlock-screen");
  };

  private readonly observeNetwork = (): void => {
    const online = net.isOnline();
    if (online === this.online) {
      return;
    }

    this.online = online;
    this.observedAt = Date.now();
    this.emit({
      kind: "network",
      online,
      state: this.snapshot(),
    });
  };

  private emitPowerSignal(
    event: Extract<RecoverySignal, { kind: "power" }>["event"],
  ): void {
    this.observedAt = Date.now();
    this.emit({
      kind: "power",
      event,
      state: this.snapshot(),
    });
  }

  private snapshot(): RecoveryState {
    return {
      suspended: this.suspended,
      screenLocked: this.screenLocked,
      online: this.online,
      observedAt: this.observedAt,
    };
  }

  private emit(signal: RecoverySignal): void {
    for (const listener of this.listeners) {
      listener(signal);
    }
  }
}
