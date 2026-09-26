import type { BotFrame } from "./core/engine";

// Draws a Bloub as pixel art: the same frame as the SVG view, snapped to a grid of solid square
// pixels. Each layer (body, dots, eyes, rings, notification dot) is drawn on its own, and a pixel
// turns on only where the layer covers enough of it, so edges stay hard while fades stay smooth.

const NOTIF_COLOR = "#41D1FF";
const TEAR_UNIT = 0.118;
const ACROSS = 16; // pixels across the body (the -100..100 box)
const MIN_PX = 3; // smallest pixel, in device pixels, so tiny blobs still read as pixel art
const OVERFLOW = 0.15; // room around the box, like the SVG's overflow: visible
const ON = 0.5; // how much of a pixel a layer must cover to light it
const SMALL_ON = 0.3; // tear drops are small: a lower bar, so they stay whole
const EYE_ON = 0.45; // eyes: a touch under half, with each eye snapped to the grid so the pair matches

export interface PixelView {
  el: HTMLElement;
  render(frame: BotFrame, color: string): void;
  destroy(): void;
}

const matrix = (m: string) => m.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number) as [number, number, number, number, number, number];

export function createPixelView(container: Element, size: number): PixelView {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const px = Math.max(MIN_PX, Math.round((size * dpr) / ACROSS)); // device pixels per blob pixel
  const perUnit = (size * dpr) / px / 200; // blob pixels per viewBox unit
  // Grid is n × n, even, so the blob's centre sits on a pixel edge and its outline is symmetric.
  const n = 2 * Math.ceil(100 * (1 + 2 * OVERFLOW) * perUnit);
  const cssSide = (n * px) / dpr;

  const el = document.createElement("span");
  el.style.cssText = `display:block;position:relative;width:${size}px;height:${size}px`;
  el.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const off = (size - cssSide) / 2;
  canvas.style.cssText = `position:absolute;left:${off}px;top:${off}px;width:${cssSide}px;height:${cssSide}px;image-rendering:pixelated;pointer-events:none`;
  el.appendChild(canvas);
  container.appendChild(el);

  const out = canvas.getContext("2d")!;
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = n;
  const s = scratch.getContext("2d", { willReadFrequently: true })!;
  const base = () => s.setTransform(perUnit, 0, 0, perUnit, n / 2, n / 2);

  const lit = new Uint8Array(n * n);

  // Draws one layer on the scratch canvas at full strength, then lights the pixels it covers.
  // `color` null keeps each pixel's own colour (the rings' gradient). `prune` drops lone pixels
  // sticking out of an outline (fewer than two lit neighbours), the nubs pixel art avoids.
  const layer = (draw: () => void, color: string | null, opacity: number, on = ON, prune = false) => {
    if (opacity <= 0.01) return;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, n, n);
    base();
    draw();
    const d = s.getImageData(0, 0, n, n).data;
    out.globalAlpha = Math.min(1, opacity);
    if (color) out.fillStyle = color;
    const bar = on * 255;
    for (let i = 0; i < n * n; i++) lit[i] = d[i * 4 + 3] >= bar ? 1 : 0;
    for (let i = 0; i < n * n; i++) {
      if (!lit[i]) continue;
      const x = i % n;
      if (prune && (x > 0 ? lit[i - 1] : 0) + (x < n - 1 ? lit[i + 1] : 0) + (lit[i - n] ?? 0) + (lit[i + n] ?? 0) < 2) continue;
      const a = d[i * 4 + 3];
      if (!color) out.fillStyle = `rgb(${(d[i * 4] * 255) / a},${(d[i * 4 + 1] * 255) / a},${(d[i * 4 + 2] * 255) / a})`;
      out.fillRect(x, (i / n) | 0, 1, 1);
    }
  };

  const circle = (x: number, y: number, r: number) => {
    s.beginPath();
    s.arc(x, y, r, 0, Math.PI * 2);
    s.fill();
  };

  // A round dot snapped to the grid: a whole number of pixels wide, corners clipped from 4 up, so
  // every dot is the same clean shape wherever it sits.
  const blip = (x: number, y: number, r: number, color: string, opacity: number) => {
    if (opacity <= 0.01 || r <= 0) return;
    const k = Math.max(1, Math.round(2 * r * perUnit));
    const left = Math.round(n / 2 + x * perUnit - k / 2);
    const top = Math.round(n / 2 + y * perUnit - k / 2);
    const cut = k >= 6 ? 2 : k >= 4 ? 1 : 0;
    out.globalAlpha = Math.min(1, opacity);
    out.fillStyle = color;
    for (let j = 0; j < k; j++) { // row by row, so a fading dot has no overlaps to double up
      const inset = Math.max(0, cut - j, j - (k - 1 - cut));
      out.fillRect(left + inset, top + j, k - 2 * inset, 1);
    }
  };

  const dots = (list: BotFrame["dots"], color: string) => {
    for (const d of list) {
      if (!d.d) { blip(d.x, d.y, d.r, d.color ?? color, d.opacity); continue; }
      layer(() => {
        s.fillStyle = "#fff";
        s.translate(d.x, d.y);
        s.rotate(((d.rot ?? 0) * Math.PI) / 180);
        s.scale(d.r / TEAR_UNIT, d.r / TEAR_UNIT);
        s.fill(new Path2D(d.d));
      }, d.color ?? color, d.opacity, SMALL_ON);
    }
  };

  return {
    el,
    render(frame, color) {
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.globalAlpha = 1;
      out.clearRect(0, 0, n, n);

      if (frame.dotsBehind) dots(frame.dots, color);
      layer(() => {
        s.fillStyle = "#fff";
        s.fill(new Path2D(frame.bodyPath));
        if (frame.notch && frame.notch.r > 0) {
          s.globalCompositeOperation = "destination-out";
          circle(frame.notch.x, frame.notch.y, frame.notch.r);
          s.globalCompositeOperation = "source-over";
        }
      }, color, frame.bodyAlpha, ON, true);
      if (!frame.dotsBehind) dots(frame.dots, color);

      for (const e of frame.eyes) {
        layer(() => {
          s.fillStyle = "#fff";
          // Each eye's centre lands on a pixel corner, so the pair comes out as a matching pair.
          const [a, b, c, d, x, y] = matrix(e.matrix);
          s.setTransform(perUnit, 0, 0, perUnit, Math.round(n / 2 + x * perUnit), Math.round(n / 2 + y * perUnit));
          s.transform(a, b, c, d, 0, 0);
          s.fill(new Path2D(e.d));
        }, "#fff", e.alpha, EYE_ON);
      }

      for (const a of frame.arcs) {
        layer(() => {
          const g = s.createLinearGradient(a.grad.x1, a.grad.y1, a.grad.x2, a.grad.y2);
          a.grad.stops.forEach((c, k) => g.addColorStop(k / 2, c));
          s.strokeStyle = g;
          s.lineWidth = a.width;
          s.lineCap = "round";
          s.stroke(new Path2D(a.front));
        }, null, a.opacity);
      }

      if (frame.notif) blip(frame.notif.x, frame.notif.y, frame.notif.r, NOTIF_COLOR, 1);
    },
    destroy() {
      el.remove();
    },
  };
}
