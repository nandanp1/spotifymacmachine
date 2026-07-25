// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DevicePopover,
  type AuraDevice,
} from "../../src/renderer/components/DevicePopover";
import { Transport } from "../../src/renderer/components/Transport";

Object.assign(globalThis, { React });

afterEach(() => {
  cleanup();
});

describe("remote-control transport", () => {
  it("keeps the signed-out preview transport interactive by default", async () => {
    const user = userEvent.setup();
    const callbacks = createTransportCallbacks();

    render(
      React.createElement(Transport, {
        visible: true,
        playing: true,
        positionMs: 30_000,
        durationMs: 180_000,
        volume: 0.6,
        ...callbacks,
      }),
    );

    const pauseButton = screen.getByRole("button", { name: "Pause" });
    const seekSlider = screen.getByRole("slider", {
      name: "Playback position",
    });
    const volumeSlider = screen.getByRole("slider", {
      name: "Volume 60 percent",
    });

    expect(pauseButton).toBeEnabled();
    expect(seekSlider).toBeEnabled();
    expect(volumeSlider).toBeEnabled();

    await user.click(pauseButton);
    fireEvent.change(seekSlider, { target: { value: "40000" } });
    fireEvent.change(seekSlider, { target: { value: "45000" } });
    fireEvent.change(volumeSlider, { target: { value: "0.4" } });

    expect(callbacks.onPlayPause).toHaveBeenCalledOnce();
    expect(callbacks.onSeek).not.toHaveBeenCalled();
    expect(callbacks.onVolume).not.toHaveBeenCalled();
    expect(seekSlider).toHaveValue("45000");
    expect(seekSlider).toHaveAttribute("aria-valuetext", "0:45 of 3:00");

    fireEvent.pointerUp(seekSlider);
    fireEvent.pointerUp(seekSlider);
    fireEvent.blur(seekSlider);
    fireEvent.keyUp(volumeSlider, { key: "ArrowLeft" });
    fireEvent.blur(volumeSlider);

    expect(callbacks.onSeek).toHaveBeenCalledOnce();
    expect(callbacks.onSeek).toHaveBeenCalledWith(45_000);
    expect(callbacks.onVolume).toHaveBeenCalledOnce();
    expect(callbacks.onVolume).toHaveBeenCalledWith(0.4);
  });

  it("accepts external slider updates whenever the user is not editing", () => {
    const callbacks = createTransportCallbacks();
    const { rerender } = render(
      React.createElement(Transport, {
        visible: true,
        playing: true,
        positionMs: 30_000,
        durationMs: 180_000,
        volume: 0.6,
        ...callbacks,
      }),
    );
    const seekSlider = screen.getByRole("slider", {
      name: "Playback position",
    });
    const volumeSlider = screen.getByRole("slider", {
      name: "Volume 60 percent",
    });

    rerender(
      React.createElement(Transport, {
        visible: true,
        playing: true,
        positionMs: 32_000,
        durationMs: 180_000,
        volume: 0.8,
        ...callbacks,
      }),
    );

    expect(seekSlider).toHaveValue("32000");
    expect(volumeSlider).toHaveValue("0.8");

    fireEvent.pointerDown(seekSlider);
    rerender(
      React.createElement(Transport, {
        visible: true,
        playing: true,
        positionMs: 34_000,
        durationMs: 180_000,
        volume: 0.9,
        ...callbacks,
      }),
    );

    expect(seekSlider).toHaveValue("32000");
    expect(volumeSlider).toHaveValue("0.9");
    fireEvent.pointerUp(seekSlider);
    expect(seekSlider).toHaveValue("34000");
    expect(callbacks.onSeek).not.toHaveBeenCalled();

    fireEvent.pointerDown(seekSlider);
    fireEvent.change(seekSlider, { target: { value: "45000" } });
    rerender(
      React.createElement(Transport, {
        visible: true,
        playing: true,
        positionMs: 36_000,
        durationMs: 180_000,
        volume: 0.9,
        ...callbacks,
      }),
    );
    expect(seekSlider).toHaveValue("45000");

    fireEvent.pointerUp(seekSlider);
    expect(callbacks.onSeek).toHaveBeenCalledOnce();
    expect(callbacks.onSeek).toHaveBeenCalledWith(45_000);

    rerender(
      React.createElement(Transport, {
        visible: true,
        playing: true,
        positionMs: 46_000,
        durationMs: 180_000,
        volume: 0.7,
        ...callbacks,
      }),
    );

    expect(seekSlider).toHaveValue("46000");
    expect(volumeSlider).toHaveValue("0.7");
  });

  it("keeps connected playback inert until an explicit target is ready", async () => {
    const user = userEvent.setup();
    const callbacks = createTransportCallbacks();

    render(
      React.createElement(Transport, {
        visible: true,
        playbackEnabled: false,
        volumeEnabled: false,
        playing: false,
        positionMs: 0,
        durationMs: 180_000,
        volume: 0.6,
        ...callbacks,
      }),
    );

    const targetRequiredButtons = screen.getAllByRole("button", {
      name: "Choose a playback device first",
    });
    expect(targetRequiredButtons).toHaveLength(3);
    for (const button of targetRequiredButtons) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(
      screen.getByRole("slider", { name: "Playback position" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("slider", {
        name: "Volume unavailable for the selected device",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Choose playback device" }),
    ).toBeEnabled();
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    expect(callbacks.onPrevious).not.toHaveBeenCalled();
    expect(callbacks.onNext).not.toHaveBeenCalled();
  });

  it("disables only playback actions Spotify marks unavailable", () => {
    const callbacks = createTransportCallbacks();

    render(
      React.createElement(Transport, {
        visible: true,
        playbackEnabled: true,
        volumeEnabled: true,
        playing: true,
        restrictions: {
          pausing: true,
          seeking: true,
          skippingNext: true,
          skippingPrevious: false,
        },
        positionMs: 30_000,
        durationMs: 180_000,
        volume: 0.6,
        ...callbacks,
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Pause unavailable on selected device",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Next unavailable on selected device",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Previous track" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("slider", { name: "Playback position" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("slider", { name: "Volume 60 percent" }),
    ).toBeEnabled();
  });
});

describe("remote-control device picker", () => {
  it("allows an already-active Spotify device to become the explicit target", async () => {
    const user = userEvent.setup();
    const activeDevice: AuraDevice = {
      id: "living-room",
      name: "Living Room",
      type: "speaker",
      isActive: true,
      available: true,
      supportsVolume: true,
    };
    const onSelect = vi.fn();

    render(
      React.createElement(DevicePopover, {
        open: true,
        connected: true,
        devices: [activeDevice],
        loadState: "ready",
        onClose: vi.fn(),
        onSelect,
        onConnect: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    const activeDeviceButton = screen.getByRole("button", {
      name: /Living RoomActive on Spotify · select to control/i,
    });
    expect(activeDeviceButton).toBeEnabled();
    expect(activeDeviceButton).toHaveAttribute("aria-pressed", "false");

    await user.click(activeDeviceButton);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(activeDevice);
  });

  it("describes the selected device as a remote target without local-playback claims", () => {
    const selectedDevice: AuraDevice = {
      id: "phone",
      name: "Pixel",
      type: "smartphone",
      isActive: true,
      available: true,
      supportsVolume: false,
    };

    render(
      React.createElement(DevicePopover, {
        open: true,
        connected: true,
        devices: [selectedDevice],
        loadState: "ready",
        selectedDeviceId: selectedDevice.id,
        onClose: vi.fn(),
        onSelect: vi.fn(),
        onConnect: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(
      screen.getByText("Remote control target · active"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Audio stays on the Spotify device you explicitly select.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Playing here")).not.toBeInTheDocument();
    expect(screen.queryByText(/Aura Player — Mac/i)).not.toBeInTheDocument();
  });

  it("labels the signed-out picker as a preview rather than a device", () => {
    render(
      React.createElement(DevicePopover, {
        open: true,
        connected: false,
        devices: [],
        loadState: "idle",
        onClose: vi.fn(),
        onSelect: vi.fn(),
        onConnect: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(screen.getByRole("heading", { name: "Preview mode" })).toBeInTheDocument();
    expect(screen.queryByText("Preview device only")).not.toBeInTheDocument();
  });
});

function createTransportCallbacks() {
  return {
    onPlayPause: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onSeek: vi.fn(),
    onVolume: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenDevices: vi.fn(),
    onOpenSettings: vi.fn(),
  };
}
