// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

import {
  LyricsPanel,
  type LyricsPanelStatus,
} from "../../src/renderer/components/LyricsPanel";
import type { LyricsResult } from "../../src/renderer/features/lyrics/types";

Object.assign(globalThis, { React });

const syncedLyrics: LyricsResult = {
  kind: "synced",
  source: "Original test score",
  lines: [
    { startMs: 1_000, endMs: 2_000, text: "First original line" },
    { startMs: 3_000, endMs: 4_000, text: "Second original line" },
    {
      startMs: 5_000,
      endMs: 6_000,
      text: "",
      instrumental: true,
    },
    { startMs: 7_000, endMs: 8_000, text: "Final original line" },
  ],
};

const scrollTo = vi.fn();
const resizeObservers: MockResizeObserver[] = [];

class MockResizeObserver {
  readonly observed: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve(target: Element) {
    const index = this.observed.indexOf(target);
    if (index >= 0) {
      this.observed.splice(index, 1);
    }
  }

  disconnect() {
    this.observed.length = 0;
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  motionPreference.reduced = false;
  resizeObservers.length = 0;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--text-scale");
  scrollTo.mockReset();
});

describe("darkroom lyrics score", () => {
  it("keeps the full transcript available and marks only the timed line", () => {
    renderLyrics({ positionMs: 1_500 });

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("First original line")).toBeInTheDocument();
    expect(screen.getByText("Second original line")).toBeInTheDocument();
    expect(screen.getByText("Final original line")).toBeInTheDocument();

    const score = document.querySelector(".lyrics-score");
    const current = document.querySelector('[aria-current="time"]');
    expect(current).toHaveTextContent("Current line: First original line");
    expect(current).not.toHaveClass("lyric-line--past");
    expect(current).not.toHaveClass("lyric-line--future");
    expect(screen.getByText("Second original line").closest("li")).toHaveClass(
      "lyric-line--future",
    );
    expect(score).toHaveAttribute("data-phase", "active");
    expect(score).toHaveAttribute("data-timing", "bounded");
    expect(score).toHaveAttribute("data-progress", "0.500");
    expect(score).toHaveStyle({
      "--lyric-exposure-opacity": "0.680",
    });
    expect(document.querySelectorAll('[aria-current="time"]')).toHaveLength(1);
    expect(screen.getByText("Darkroom score")).toBeInTheDocument();
    expect(screen.getByText("Original test score")).toBeInTheDocument();
    expect(screen.getByText("following playback")).toBeInTheDocument();
  });

  it("does not claim a lyric is current during an explicit timing gap", () => {
    renderLyrics({ positionMs: 2_500 });

    const score = document.querySelector(".lyrics-score");
    expect(document.querySelector('[aria-current="time"]')).toBeNull();
    expect(score).toHaveAttribute("data-phase", "gap");
    expect(score).toHaveAttribute("data-timing", "quiet");
    expect(score).not.toHaveAttribute("data-progress");
    expect(score).toHaveStyle({
      "--lyric-exposure-opacity": "0.000",
    });
    expect(screen.getByText("First original line").closest("li")).toHaveClass(
      "lyric-line--past",
    );
    expect(screen.getByText("Second original line").closest("li")).toHaveClass(
      "lyric-line--future",
    );
    expect(screen.getByText("instrumental space")).toBeInTheDocument();
  });

  it("renders an instrumental passage intentionally and accessibly", () => {
    renderLyrics({ positionMs: 5_500 });

    const current = document.querySelector('[aria-current="time"]');
    expect(current).toHaveTextContent("Current line: Instrumental passage");
    expect(current?.querySelectorAll(".instrumental-motif i")).toHaveLength(3);
  });

  it("scrolls only when the reading anchor changes", () => {
    const { rerender } = renderLyrics({ positionMs: 1_100 });
    const firstLineNodes = [...document.querySelectorAll(".lyric-line")];
    const firstLineParagraph = screen
      .getByText("First original line")
      .closest("p");
    expect(
      [...(firstLineParagraph?.childNodes ?? [])].filter(
        (node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      ),
    ).toHaveLength(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    rerender(createPanel({ positionMs: 1_800 }));
    const progressLineNodes = [...document.querySelectorAll(".lyric-line")];
    expect(progressLineNodes).toHaveLength(firstLineNodes.length);
    progressLineNodes.forEach((node, index) => {
      expect(node).toBe(firstLineNodes[index]);
    });
    expect(document.querySelector(".lyrics-score")).toHaveStyle({
      "--lyric-exposure-opacity": "0.466",
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);

    rerender(createPanel({ positionMs: 3_200 }));
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    expect(screen.getByText("First original line").closest("li")).toHaveClass(
      "lyric-line--past",
    );
    expect(screen.getByText("Second original line").closest("li")).toHaveClass(
      "lyric-line--active",
    );
    expect(
      screen.getByText("Instrumental passage").closest("li"),
    ).toHaveClass("lyric-line--future");
    expect(document.querySelectorAll(".lyric-line--active")).toHaveLength(1);
    expect(resizeObservers).toHaveLength(2);

    resizeObservers[1]?.trigger();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );

    rerender(createPanel({ positionMs: 7_200 }));
    expect(scrollTo).toHaveBeenCalledTimes(3);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
  });

  it("reanchors when text scaling changes the score geometry", () => {
    renderLyrics({ positionMs: 1_500 });
    const current = document.querySelector('[aria-current="time"]');
    const score = document.querySelector(".lyrics-score");
    const viewport = document.querySelector(".lyrics-viewport");
    expect(current).not.toBeNull();
    expect(score).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(resizeObservers).toHaveLength(1);
    expect(resizeObservers[0]?.observed).toEqual(
      expect.arrayContaining([viewport, score, current]),
    );

    Object.defineProperty(current, "offsetTop", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(current, "offsetHeight", {
      configurable: true,
      value: 96,
    });
    document.documentElement.style.setProperty("--text-scale", "1.25");

    resizeObservers[0]?.trigger();

    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 192,
      behavior: "auto",
    });
  });

  it("avoids smooth lyric motion when reduced motion is requested", () => {
    motionPreference.reduced = true;
    const { rerender } = renderLyrics({ positionMs: 1_100 });

    expect(
      document.querySelector(".lyrics-panel--reduced-motion"),
    ).toBeInTheDocument();
    expect(document.querySelector(".lyrics-score")).toHaveStyle({
      "--lyric-exposure-opacity": "0.420",
    });

    rerender(createPanel({ positionMs: 3_200 }));

    expect(document.querySelector(".lyrics-score")).toHaveStyle({
      "--lyric-exposure-opacity": "0.420",
    });
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
  });

  it("leaves the timing rail indeterminate when the source has no final end", () => {
    renderLyrics({
      lyrics: {
        kind: "synced",
        source: "Open-ended fixture",
        lines: [{ startMs: 1_000, text: "An open final line" }],
      },
      positionMs: 5_000,
    });

    expect(document.querySelector(".lyrics-score")).not.toHaveAttribute(
      "data-progress",
    );
    expect(document.querySelector(".lyrics-score")).toHaveAttribute(
      "data-timing",
      "indeterminate",
    );
    expect(document.querySelector(".lyrics-score")).toHaveStyle({
      "--lyric-exposure-opacity": "0.380",
    });
    expect(document.querySelector('[aria-current="time"]')).toHaveClass(
      "lyric-line--indeterminate",
    );
  });

  it("provides honest loading and import states", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const { rerender } = render(
      createPanel({
        lyrics: null,
        positionMs: 0,
        status: "loading",
        onImport,
      }),
    );

    expect(
      screen.getByRole("status", { name: "Checking for saved lyrics" }),
    ).toBeInTheDocument();

    rerender(
      createPanel({
        lyrics: null,
        positionMs: 0,
        status: "unavailable",
        onImport,
      }),
    );
    const importButton = screen.getByRole("button", {
      name: "Import synced .lrc",
    });
    await user.click(importButton);
    expect(onImport).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/does not provide lyric text to Aura/i),
    ).toBeInTheDocument();
  });

  it("makes plain lyrics keyboard-scrollable", () => {
    renderLyrics({
      lyrics: {
        kind: "plain",
        source: "Licensed fixture",
        text: "An original plain line\nAnother original plain line",
      },
      positionMs: 0,
    });

    const region = screen.getByRole("region", {
      name: "Scrollable plain lyrics",
    });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveTextContent("An original plain line");
  });

  it("treats an empty synchronized result as unavailable", () => {
    renderLyrics({
      lyrics: {
        kind: "synced",
        source: "Empty fixture",
        lines: [],
      },
      positionMs: 0,
    });

    expect(
      screen.getByRole("heading", { name: "The music can keep the room." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

interface PanelOverrides {
  lyrics: LyricsResult | null;
  positionMs: number;
  status: LyricsPanelStatus;
  onImport?: () => void;
}

function createPanel(overrides: Partial<PanelOverrides> = {}) {
  return React.createElement(LyricsPanel, {
    lyrics: syncedLyrics,
    positionMs: 1_500,
    offsetMs: 0,
    visible: true,
    trackKey: "test-track",
    trackTitle: "Original test track",
    status: "ready",
    ...overrides,
  });
}

function renderLyrics(overrides: Partial<PanelOverrides> = {}) {
  return render(createPanel(overrides));
}
