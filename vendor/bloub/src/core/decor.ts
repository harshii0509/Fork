import { TAU, clamp, createRng, r2 } from "./math";

export function wheel(hue: number, s = 0.55, l = 0.62): string {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r: number, g: number, b: number;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export interface DotRender {
  x: number;
  y: number;
  r: number;
  opacity: number;
  color?: string;
  depth?: number;
  d?: string;
  rot?: number;
}

export interface ArcSeed {
  a: number;
  k: number;
  tilt: number;
  speed: number;
  phase: number;
  sweep: number;
  hue: number;
  hueSpan: number;
  width: number;
  cx: number;
  cy: number;
}

export interface ArcSpec {
  id: string;
  seed: ArcSeed;
  t: number;
  opacity: number;
}

export interface ArcGrad {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: [string, string, string];
}

export interface ArcRender {
  id: string;
  front: string;
  back: string;
  width: number;
  opacity: number;
  grad: ArcGrad;
}

export function arcRender(seed: ArcSeed, t: number, scale: number, id: string, opacity = 1): ArcRender {
  const spin = seed.phase + t * seed.speed * TAU;
  const cu = Math.cos(seed.tilt);
  const su = Math.sin(seed.tilt);
  const kz = Math.sqrt(Math.max(0, 1 - seed.k * seed.k));
  const n = 64;
  const span = seed.sweep * TAU;
  let front = "";
  let back = "";
  let prev: boolean | undefined;

  for (let i = 0; i <= n; i++) {
    const th = spin + (i / n) * span;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const x = seed.a * (ct * cu + st * -su * seed.k) + seed.cx;
    const y = seed.a * (ct * su + st * cu * seed.k) + seed.cy;
    const z = seed.a * st * kz;
    const behind = z < 0;
    const seg = `${behind !== prev ? "M" : "L"}${r2(x * scale)} ${r2(y * scale)}`;
    if (behind) back += seg;
    else front += seg;
    prev = behind;
  }

  const gx = Math.cos(seed.tilt) * seed.a * scale;
  const gy = Math.sin(seed.tilt) * seed.a * scale;
  return {
    id, front, back, width: seed.width * scale, opacity,
    grad: {
      x1: r2(seed.cx * scale - gx),
      y1: r2(seed.cy * scale - gy),
      x2: r2(seed.cx * scale + gx),
      y2: r2(seed.cy * scale + gy),
      stops: [wheel(seed.hue), wheel(seed.hue + seed.hueSpan * 0.5), wheel(seed.hue + seed.hueSpan)],
    },
  };
}

const ringRng = createRng(0xa11ce);
export const rings: ArcSeed[] = Array.from({ length: 6 }, (_, i) => ({
  a: 1.3 + ringRng() * 0.1,
  k: 0.05 + ringRng() * 0.4,
  tilt: (i / 6) * Math.PI + ringRng() * 0.5,
  speed: 3 + ringRng() * 0.7,
  phase: ringRng() * TAU,
  sweep: 0.6 + ringRng() * 0.25,
  hue: (i * 360) / 6 + ringRng() * 30,
  hueSpan: 60 + ringRng() * 60,
  width: 0.05 + ringRng() * 0.012,
  cx: 0,
  cy: 0.1,
}));

export const swoosh: ArcSeed[] = Array.from({ length: 4 }, (_, i) => ({
  a: 0.78 + i * 0.2,
  k: 0.05 + i * 0.02,
  tilt: -0.62 + i * 0.05,
  speed: 0.3,
  phase: 0.06 * i,
  sweep: 0.4,
  hue: 95 + i * 62,
  hueSpan: 100,
  width: 0.05,
  cx: 0,
  cy: -0.12,
}));

export const DOT_X = [-0.557, -0.013, 0.532] as const;
export const DOT_R = 0.165;
export const DOT_PEAK = 1.25;

const pRng = createRng(0xbeef);
const particlesSpec = Array.from({ length: 5 }, (_, i) => ({
  birth: i * 0.2,
  angle: pRng() * TAU,
  rho: 0.58 + pRng() * 0.18,
}));

export function getParticles(t: number, scale: number): DotRender[] {
  const out: DotRender[] = [];
  for (const p of particlesSpec) {
    const u = t - p.birth;
    if (u < 0 || u > 0.62) continue;
    const rho = p.rho * Math.pow(0.75, u * 10);
    const a = p.angle + (u * 100 * Math.PI) / 180;
    out.push({
      x: Math.cos(a) * rho * scale,
      y: Math.sin(a) * rho * scale,
      r: (0.04 + 0.028 * clamp(u / 0.55)) * scale,
      depth: clamp(1 - rho / 0.8),
      opacity: clamp(u / 0.06) * clamp((0.62 - u) / 0.08),
    });
  }
  return out;
}

export const NOTIF_BLUE = "#2496e8";
export const NOTIF_ANGLE = -42;
export const NOTIF_DIST = 1.003;
export const NOTIF_R = 0.15;
export const NOTIF_POP = 1.14;
export const NOTIF_MARGIN = 0.054;
