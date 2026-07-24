import {
  NOCTURNE_FALLBACK_PALETTE,
  createSeededRandom,
  hashTrackId,
  type VisualEngine,
  type VisualPalette,
  type VisualPlaybackState,
  type VisualTrackContext,
} from "./visual-engine";
import type { VisualMode } from "../../../shared/types";

type Rgb = readonly [number, number, number];

interface LightField {
  x: number;
  y: number;
  radius: number;
  driftX: number;
  driftY: number;
  phase: number;
  color: keyof Pick<VisualPalette, "primary" | "accent" | "highlight">;
  alpha: number;
}

interface Ripple {
  startedAt: number;
  x: number;
}

interface ModeProfile {
  artworkAlpha: number;
  fieldCount: number;
  grainAlpha: number;
  motionScale: number;
  radiusScale: number;
}

const PALETTE_TRANSITION_MS = 1_600;
const STATIC_FRAME_DELAY_MS = 700;
const MAX_PIXEL_RATIO = 2;
const LOW_POWER_MAX_PIXEL_RATIO = 1.35;
const MODE_PROFILES: Record<VisualMode, ModeProfile> = {
  aurora: {
    artworkAlpha: 0.13,
    fieldCount: 6,
    grainAlpha: 0.035,
    motionScale: 1,
    radiusScale: 1,
  },
  bloom: {
    artworkAlpha: 0.09,
    fieldCount: 5,
    grainAlpha: 0.028,
    motionScale: 0.72,
    radiusScale: 1.18,
  },
  orbit: {
    artworkAlpha: 0.1,
    fieldCount: 6,
    grainAlpha: 0.025,
    motionScale: 1.25,
    radiusScale: 0.68,
  },
  glass: {
    artworkAlpha: 0.17,
    fieldCount: 4,
    grainAlpha: 0.018,
    motionScale: 0.42,
    radiusScale: 0.78,
  },
  ink: {
    artworkAlpha: 0.055,
    fieldCount: 3,
    grainAlpha: 0.055,
    motionScale: 0.54,
    radiusScale: 0.82,
  },
  minimal: {
    artworkAlpha: 0.045,
    fieldCount: 1,
    grainAlpha: 0.012,
    motionScale: 0.18,
    radiusScale: 1.3,
  },
};

export class CanvasVisualEngine implements VisualEngine {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private intensity = 0.72;
  private mode: VisualMode = "aurora";
  private palette: VisualPalette = NOCTURNE_FALLBACK_PALETTE;
  private previousPalette: VisualPalette = NOCTURNE_FALLBACK_PALETTE;
  private transitionStartedAt = 0;
  private trackSeed = hashTrackId("aura-nocturne");
  private fields: LightField[] = [];
  private artworkLayer: HTMLCanvasElement | null = null;
  private grainPattern: CanvasPattern | null = null;
  private playbackState: VisualPlaybackState | null = null;
  private lastKnownPositionMs: number | null = null;
  private ripple: Ripple | null = null;
  private animationFrame: number | null = null;
  private delayedFrame: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private initialized = false;
  private destroyed = false;
  private visible = true;
  private reducedMotion = false;
  private lowPower = false;
  private mediaQuery: MediaQueryList | null = null;
  private paletteListeners = new Set<(palette: VisualPalette) => void>();

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (this.initialized && this.canvas === canvas) {
      return;
    }
    if (this.initialized) {
      this.destroy();
    }

    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) {
      throw new Error("Aura Player could not create a Canvas 2D context.");
    }

    this.destroyed = false;
    this.initialized = true;
    this.canvas = canvas;
    this.context = context;
    this.visible =
      typeof document === "undefined" ||
      document.visibilityState !== "hidden";
    this.lowPower = detectLowPowerDevice();

    if (typeof window !== "undefined") {
      this.mediaQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      this.reducedMotion = this.mediaQuery.matches;
      this.mediaQuery.addEventListener?.(
        "change",
        this.handleMotionPreference,
      );
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }

    const rect = canvas.getBoundingClientRect();
    this.resize(
      Math.max(1, rect.width || canvas.clientWidth || 1),
      Math.max(1, rect.height || canvas.clientHeight || 1),
      typeof window === "undefined" ? 1 : window.devicePixelRatio,
    );
    this.rebuildFields();
    this.scheduleFrame(true);
  }

  async setTrack(context: VisualTrackContext): Promise<void> {
    const generation = ++this.generation;
    this.trackSeed = hashTrackId(context.trackId || "aura-no-track");
    this.previousPalette = this.getRenderedPalette(performanceNow());

    let nextPalette = deterministicPalette(this.trackSeed);
    let image: HTMLImageElement | null = null;

    if (context.artworkUrl) {
      try {
        image = await loadImage(context.artworkUrl);
        if (generation !== this.generation || this.destroyed) {
          return;
        }
        nextPalette = extractArtworkPalette(image, nextPalette);
      } catch {
        // Remote artwork without CORS support still receives a deterministic
        // local visual identity; the image is never uploaded or proxied.
      }
    }

    if (generation !== this.generation || this.destroyed) {
      return;
    }

    this.palette = mergePalette(nextPalette, context.palette);
    if (this.reducedMotion) {
      this.previousPalette = this.palette;
      this.transitionStartedAt = 0;
    } else {
      this.transitionStartedAt = performanceNow();
    }
    this.artworkLayer = image
      ? createArtworkLayer(image, this.width, this.height, this.pixelRatio)
      : null;
    this.rebuildFields();
    this.rebuildGrain();
    this.paletteListeners.forEach((listener) => listener(this.palette));
    this.scheduleFrame(true);
  }

  setPlaybackState(state: VisualPlaybackState): void {
    if (
      this.lastKnownPositionMs !== null &&
      state.durationMs > 0 &&
      Math.abs(state.positionMs - this.lastKnownPositionMs) > 2_800
    ) {
      this.ripple = {
        startedAt: performanceNow(),
        x: Math.min(1, Math.max(0, state.positionMs / state.durationMs)),
      };
    }

    this.lastKnownPositionMs = state.positionMs;
    this.playbackState = state;
    this.scheduleFrame(true);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.canvas || !this.context || this.destroyed) {
      return;
    }

    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    const maximumRatio = this.lowPower
      ? LOW_POWER_MAX_PIXEL_RATIO
      : MAX_PIXEL_RATIO;
    this.pixelRatio = Math.min(
      maximumRatio,
      Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1),
    );

    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(
      this.pixelRatio,
      0,
      0,
      this.pixelRatio,
      0,
      0,
    );
    this.rebuildGrain();
    this.scheduleFrame(true);
  }

  setIntensity(value: number): void {
    this.intensity = Math.min(
      1,
      Math.max(0, Number.isFinite(value) ? value : 0),
    );
    this.scheduleFrame(true);
  }

  setMode(mode: VisualMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.rebuildFields();
    this.rebuildGrain();
    this.scheduleFrame(true);
  }

  getPalette(): VisualPalette {
    return this.palette;
  }

  subscribePalette(listener: (palette: VisualPalette) => void): () => void {
    this.paletteListeners.add(listener);
    return () => {
      this.paletteListeners.delete(listener);
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.initialized = false;
    this.cancelFrames();
    this.generation += 1;

    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
    this.mediaQuery?.removeEventListener?.(
      "change",
      this.handleMotionPreference,
    );

    this.mediaQuery = null;
    this.context = null;
    this.canvas = null;
    this.artworkLayer = null;
    this.grainPattern = null;
    this.paletteListeners.clear();
  }

  private rebuildFields(): void {
    const random = createSeededRandom(this.trackSeed);
    const colors: LightField["color"][] = [
      "primary",
      "accent",
      "highlight",
    ];
    const profile = MODE_PROFILES[this.mode];
    const fieldCount = this.lowPower
      ? Math.max(1, Math.ceil(profile.fieldCount * 0.67))
      : profile.fieldCount;

    this.fields = Array.from({ length: fieldCount }, (_, index) => ({
      x: random(),
      y: 0.08 + random() * 0.84,
      radius: 0.22 + random() * 0.32,
      driftX: 0.035 + random() * 0.07,
      driftY: 0.025 + random() * 0.055,
      phase: random() * Math.PI * 2,
      color: colors[index % colors.length] ?? "primary",
      alpha: 0.16 + random() * 0.2,
    }));
  }

  private rebuildGrain(): void {
    if (!this.context || typeof document === "undefined") {
      return;
    }

    const size = 96;
    const grain = document.createElement("canvas");
    grain.width = size;
    grain.height = size;
    const grainContext = grain.getContext("2d");
    if (!grainContext) {
      return;
    }

    const imageData = grainContext.createImageData(size, size);
    const random = createSeededRandom(this.trackSeed ^ 0xa5a5a5a5);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const value = Math.round(100 + random() * 155);
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = Math.round(random() * 24);
    }
    grainContext.putImageData(imageData, 0, 0);
    this.grainPattern = this.context.createPattern(grain, "repeat");
  }

  private scheduleFrame(immediate = false): void {
    if (
      !this.initialized ||
      this.destroyed ||
      !this.visible ||
      this.animationFrame !== null ||
      this.delayedFrame !== null
    ) {
      return;
    }

    if (
      immediate ||
      (!this.playbackState?.paused &&
        !this.playbackState?.buffering &&
        !this.reducedMotion)
    ) {
      this.animationFrame = requestAnimationFrame(this.render);
      return;
    }

    if (!this.reducedMotion) {
      this.delayedFrame = setTimeout(() => {
        this.delayedFrame = null;
        this.animationFrame = requestAnimationFrame(this.render);
      }, STATIC_FRAME_DELAY_MS);
    }
  }

  private cancelFrames(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.delayedFrame !== null) {
      clearTimeout(this.delayedFrame);
      this.delayedFrame = null;
    }
  }

  private readonly render = (time: number): void => {
    this.animationFrame = null;
    const context = this.context;
    if (!context || !this.canvas || this.destroyed || !this.visible) {
      return;
    }

    const palette = this.getRenderedPalette(time);
    const profile = MODE_PROFILES[this.mode];
    const motionScale =
      (this.reducedMotion || this.playbackState?.paused ? 0.08 : 1) *
      profile.motionScale;
    const seconds = time / 1_000;

    context.save();
    context.setTransform(
      this.pixelRatio,
      0,
      0,
      this.pixelRatio,
      0,
      0,
    );
    context.fillStyle = palette.shadow;
    context.fillRect(0, 0, this.width, this.height);

    if (this.artworkLayer) {
      context.save();
      context.globalAlpha = profile.artworkAlpha * this.intensity;
      context.drawImage(
        this.artworkLayer,
        0,
        0,
        this.artworkLayer.width,
        this.artworkLayer.height,
        0,
        0,
        this.width,
        this.height,
      );
      context.restore();
    }

    if (this.mode === "glass") {
      this.drawGlassFacets(context, palette, seconds, motionScale);
    } else if (this.mode === "ink") {
      this.drawInkRibbons(context, palette, seconds, motionScale);
    }

    context.globalCompositeOperation = "screen";
    for (const [index, field] of this.fields.entries()) {
      const { x, y, radius } = this.resolveFieldGeometry(
        field,
        index,
        seconds,
        motionScale,
        profile.radiusScale,
      );
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(
        0,
        colorWithAlpha(
          palette[field.color],
          field.alpha * this.intensity,
        ),
      );
      gradient.addColorStop(0.52, colorWithAlpha(palette[field.color], 0.06));
      gradient.addColorStop(1, colorWithAlpha(palette[field.color], 0));
      context.fillStyle = gradient;
      context.fillRect(0, 0, this.width, this.height);
    }

    this.drawSeekRipple(context, palette, time);

    context.globalCompositeOperation = "source-over";
    const readabilityVeil = context.createLinearGradient(
      this.width * 0.34,
      0,
      this.width,
      0,
    );
    readabilityVeil.addColorStop(0, "rgba(4,5,7,0.04)");
    readabilityVeil.addColorStop(0.54, "rgba(4,5,7,0.34)");
    readabilityVeil.addColorStop(1, "rgba(4,5,7,0.72)");
    context.fillStyle = readabilityVeil;
    context.fillRect(0, 0, this.width, this.height);

    const vignette = context.createRadialGradient(
      this.width * 0.46,
      this.height * 0.42,
      Math.min(this.width, this.height) * 0.12,
      this.width * 0.5,
      this.height * 0.48,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.64)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, this.width, this.height);

    if (this.grainPattern) {
      context.globalAlpha = profile.grainAlpha;
      context.fillStyle = this.grainPattern;
      context.fillRect(0, 0, this.width, this.height);
    }
    context.restore();

    this.scheduleFrame();
  };

  private resolveFieldGeometry(
    field: LightField,
    index: number,
    seconds: number,
    motionScale: number,
    radiusScale: number,
  ): { x: number; y: number; radius: number } {
    let x =
      (field.x +
        Math.sin(seconds * field.driftX * motionScale + field.phase) *
          0.19) *
      this.width;
    let y =
      (field.y +
        Math.cos(seconds * field.driftY * motionScale + field.phase) *
          0.15) *
      this.height;
    let radius =
      field.radius * Math.max(this.width, this.height) * radiusScale;

    if (this.mode === "bloom") {
      const pulse =
        0.82 +
        Math.sin(seconds * 0.16 * motionScale + field.phase) * 0.14;
      x =
        (0.5 +
          Math.sin(seconds * field.driftX * motionScale + field.phase) *
            (0.04 + index * 0.008)) *
        this.width;
      y =
        (0.48 +
          Math.cos(seconds * field.driftY * motionScale + field.phase) *
            (0.05 + index * 0.007)) *
        this.height;
      radius *= pulse;
    } else if (this.mode === "orbit") {
      const angle =
        field.phase + seconds * (0.026 + field.driftX) * motionScale;
      const lane = 0.13 + (index % 3) * 0.075;
      x = (0.46 + Math.cos(angle) * lane) * this.width;
      y = (0.48 + Math.sin(angle) * lane * 1.7) * this.height;
    } else if (this.mode === "glass") {
      x =
        (field.x +
          Math.sin(seconds * field.driftX * motionScale + field.phase) *
            0.055) *
        this.width;
      y = (0.2 + field.y * 0.66) * this.height;
    } else if (this.mode === "ink") {
      x = (0.28 + field.x * 0.42) * this.width;
      y =
        (field.y +
          Math.sin(seconds * field.driftY * motionScale + field.phase) *
            0.06) *
        this.height;
    } else if (this.mode === "minimal") {
      x = this.width * 0.44;
      y = this.height * 0.46;
    }

    return { x, y, radius };
  }

  private drawGlassFacets(
    context: CanvasRenderingContext2D,
    palette: VisualPalette,
    seconds: number,
    motionScale: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "screen";
    context.translate(
      Math.sin(seconds * 0.025 * motionScale) * this.width * 0.025,
      0,
    );

    const facets = [
      { x: -0.08, width: 0.3, color: palette.primary, alpha: 0.055 },
      { x: 0.19, width: 0.22, color: palette.highlight, alpha: 0.04 },
      { x: 0.54, width: 0.3, color: palette.accent, alpha: 0.045 },
    ];
    for (const facet of facets) {
      const left = facet.x * this.width;
      const width = facet.width * this.width;
      const gradient = context.createLinearGradient(left, 0, left + width, 0);
      gradient.addColorStop(0, colorWithAlpha(facet.color, 0));
      gradient.addColorStop(
        0.45,
        colorWithAlpha(facet.color, facet.alpha * this.intensity),
      );
      gradient.addColorStop(1, colorWithAlpha(facet.color, 0));
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(left + width * 0.34, 0);
      context.lineTo(left + width, 0);
      context.lineTo(left + width * 0.66, this.height);
      context.lineTo(left, this.height);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  private drawInkRibbons(
    context: CanvasRenderingContext2D,
    palette: VisualPalette,
    seconds: number,
    motionScale: number,
  ): void {
    context.save();
    context.globalCompositeOperation = "screen";
    context.lineCap = "round";
    const colors = [palette.primary, palette.accent, palette.highlight];

    colors.forEach((color, index) => {
      const phase = seconds * 0.035 * motionScale + index * 1.9;
      const y = this.height * (0.28 + index * 0.2);
      context.beginPath();
      context.moveTo(-this.width * 0.08, y);
      context.bezierCurveTo(
        this.width * 0.18,
        y + Math.sin(phase) * this.height * 0.2,
        this.width * 0.64,
        y + Math.cos(phase * 0.8) * this.height * 0.17,
        this.width * 1.08,
        y + Math.sin(phase * 0.55) * this.height * 0.12,
      );
      context.strokeStyle = colorWithAlpha(
        color,
        (0.032 + index * 0.006) * this.intensity,
      );
      context.lineWidth = this.height * (0.12 + index * 0.025);
      context.stroke();
    });
    context.restore();
  }

  private drawSeekRipple(
    context: CanvasRenderingContext2D,
    palette: VisualPalette,
    time: number,
  ): void {
    if (!this.ripple || this.reducedMotion) {
      return;
    }

    const progress = (time - this.ripple.startedAt) / 1_100;
    if (progress >= 1) {
      this.ripple = null;
      return;
    }

    const eased = 1 - (1 - Math.max(0, progress)) ** 3;
    const x = this.ripple.x * this.width;
    const radius = eased * Math.max(this.width, this.height) * 0.42;
    const gradient = context.createRadialGradient(
      x,
      this.height,
      Math.max(0, radius * 0.4),
      x,
      this.height,
      Math.max(1, radius),
    );
    gradient.addColorStop(
      0,
      colorWithAlpha(palette.highlight, (1 - progress) * 0.09),
    );
    gradient.addColorStop(1, colorWithAlpha(palette.highlight, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
  }

  private getRenderedPalette(time: number): VisualPalette {
    if (!this.transitionStartedAt) {
      return this.palette;
    }

    const progress = Math.min(
      1,
      Math.max(0, (time - this.transitionStartedAt) / PALETTE_TRANSITION_MS),
    );
    const eased = 1 - (1 - progress) ** 3;
    return {
      shadow: mixColors(
        this.previousPalette.shadow,
        this.palette.shadow,
        eased,
      ),
      primary: mixColors(
        this.previousPalette.primary,
        this.palette.primary,
        eased,
      ),
      accent: mixColors(
        this.previousPalette.accent,
        this.palette.accent,
        eased,
      ),
      highlight: mixColors(
        this.previousPalette.highlight,
        this.palette.highlight,
        eased,
      ),
    };
  }

  private readonly handleVisibilityChange = (): void => {
    this.visible = document.visibilityState !== "hidden";
    if (!this.visible) {
      this.cancelFrames();
      return;
    }
    this.scheduleFrame(true);
  };

  private readonly handleMotionPreference = (
    event: MediaQueryListEvent,
  ): void => {
    this.reducedMotion = event.matches;
    this.cancelFrames();
    this.scheduleFrame(true);
  };
}

function performanceNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function detectLowPowerDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  return navigator.hardwareConcurrency <= 4 || (memory !== undefined && memory <= 4);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("Album artwork failed to load.")),
      { once: true },
    );
    image.src = url;
  });
}

function extractArtworkPalette(
  image: CanvasImageSource,
  fallback: VisualPalette,
): VisualPalette {
  if (typeof document === "undefined") {
    return fallback;
  }

  const sample = document.createElement("canvas");
  sample.width = 64;
  sample.height = 64;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return fallback;
  }

  try {
    context.drawImage(image, 0, 0, 64, 64);
    const { data } = context.getImageData(0, 0, 64, 64);
    const buckets = new Map<
      string,
      { color: Rgb; count: number; saturation: number; luminance: number }
    >();

    for (let index = 0; index < data.length; index += 16) {
      if ((data[index + 3] ?? 0) < 180) {
        continue;
      }
      const color: Rgb = [
        Math.round((data[index] ?? 0) / 24) * 24,
        Math.round((data[index + 1] ?? 0) / 24) * 24,
        Math.round((data[index + 2] ?? 0) / 24) * 24,
      ];
      const key = color.join(",");
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, {
          color,
          count: 1,
          saturation: saturation(color),
          luminance: luminance(color),
        });
      }
    }

    const candidates = [...buckets.values()].sort(
      (left, right) => right.count - left.count,
    );
    const mostCommon = candidates[0];
    if (!mostCommon) {
      return fallback;
    }

    const shadowCandidate =
      candidates
        .filter((entry) => entry.luminance < 0.34)
        .sort((left, right) => right.count - left.count)[0] ?? mostCommon;
    const primaryCandidate =
      candidates
        .filter(
          (entry) => entry.luminance > 0.12 && entry.luminance < 0.72,
        )
        .sort(
          (left, right) =>
            right.count * (0.5 + right.saturation) -
            left.count * (0.5 + left.saturation),
        )[0] ?? mostCommon;
    const accentCandidate =
      candidates
        .filter((entry) => entry.saturation > 0.28)
        .sort(
          (left, right) =>
            colorDistance(right.color, primaryCandidate.color) *
              (0.3 + right.saturation) -
            colorDistance(left.color, primaryCandidate.color) *
              (0.3 + left.saturation),
        )[0] ?? primaryCandidate;
    const highlightCandidate =
      candidates
        .filter((entry) => entry.luminance > 0.58)
        .sort(
          (left, right) =>
            right.count * right.luminance - left.count * left.luminance,
        )[0] ?? accentCandidate;

    return {
      shadow: rgbToHex(darken(shadowCandidate.color, 0.52)),
      primary: rgbToHex(primaryCandidate.color),
      accent: rgbToHex(accentCandidate.color),
      highlight: rgbToHex(lighten(highlightCandidate.color, 0.18)),
    };
  } catch {
    return fallback;
  }
}

function deterministicPalette(seed: number): VisualPalette {
  const random = createSeededRandom(seed);
  const baseHue = Math.floor(random() * 360);
  return {
    shadow: hslToHex(baseHue, 18, 5),
    primary: hslToHex(baseHue, 34 + random() * 18, 25 + random() * 12),
    accent: hslToHex(
      (baseHue + 65 + random() * 100) % 360,
      52 + random() * 20,
      48 + random() * 14,
    ),
    highlight: hslToHex(
      (baseHue + 25 + random() * 55) % 360,
      38 + random() * 20,
      68 + random() * 12,
    ),
  };
}

function createArtworkLayer(
  image: HTMLImageElement,
  width: number,
  height: number,
  pixelRatio: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const scale = Math.min(1.5, pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale * 0.5));
  canvas.height = Math.max(1, Math.round(height * scale * 0.5));
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const imageRatio = image.naturalWidth / image.naturalHeight;
  const canvasRatio = canvas.width / canvas.height;
  let drawWidth = canvas.width;
  let drawHeight = canvas.height;
  let x = 0;
  let y = 0;
  if (imageRatio > canvasRatio) {
    drawWidth = canvas.height * imageRatio;
    x = (canvas.width - drawWidth) / 2;
  } else {
    drawHeight = canvas.width / imageRatio;
    y = (canvas.height - drawHeight) / 2;
  }

  context.filter = `blur(${Math.max(16, canvas.width * 0.035)}px) saturate(1.2)`;
  context.drawImage(image, x, y, drawWidth, drawHeight);
  return canvas;
}

function mergePalette(
  extracted: VisualPalette,
  override: Partial<VisualPalette> | undefined,
): VisualPalette {
  return {
    shadow: override?.shadow ?? extracted.shadow,
    primary: override?.primary ?? extracted.primary,
    accent: override?.accent ?? extracted.accent,
    highlight: override?.highlight ?? extracted.highlight,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(
    1,
    Math.max(0, alpha),
  )})`;
}

function mixColors(left: string, right: string, amount: number): string {
  const a = parseHex(left);
  const b = parseHex(right);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

function parseHex(value: string): Rgb {
  const normalized = value.replace("#", "");
  if (normalized.length === 3) {
    const red = normalized.charAt(0);
    const green = normalized.charAt(1);
    const blue = normalized.charAt(2);
    return [
      Number.parseInt(red + red, 16),
      Number.parseInt(green + green, 16),
      Number.parseInt(blue + blue, 16),
    ];
  }
  if (normalized.length !== 6) {
    return [0, 0, 0];
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex(color: readonly number[]): string {
  return `#${color
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(color: Rgb): number {
  return (
    (color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722) / 255
  );
}

function saturation(color: Rgb): number {
  const maximum = Math.max(...color) / 255;
  const minimum = Math.min(...color) / 255;
  if (maximum === minimum) {
    return 0;
  }
  const lightness = (maximum + minimum) / 2;
  return (maximum - minimum) / (1 - Math.abs(2 * lightness - 1));
}

function colorDistance(left: Rgb, right: Rgb): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function darken(color: Rgb, amount: number): Rgb {
  return [
    color[0] * (1 - amount),
    color[1] * (1 - amount),
    color[2] * (1 - amount),
  ];
}

function lighten(color: Rgb, amount: number): Rgb {
  return [
    color[0] + (255 - color[0]) * amount,
    color[1] + (255 - color[1]) * amount,
    color[2] + (255 - color[2]) * amount,
  ];
}

function hslToHex(hue: number, saturationValue: number, lightness: number): string {
  const saturationFraction = saturationValue / 100;
  const lightnessFraction = lightness / 100;
  const chroma =
    (1 - Math.abs(2 * lightnessFraction - 1)) * saturationFraction;
  const segment = ((hue % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const values: Rgb =
    segment < 1
      ? [chroma, secondary, 0]
      : segment < 2
        ? [secondary, chroma, 0]
        : segment < 3
          ? [0, chroma, secondary]
          : segment < 4
            ? [0, secondary, chroma]
            : segment < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const offset = lightnessFraction - chroma / 2;
  return rgbToHex(values.map((value) => (value + offset) * 255));
}
