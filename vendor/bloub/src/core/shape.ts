import { PROFILE_SAMPLES, profiles, type ProfileName } from "./profiles";
import { TAU, clamp, lerp, r2 } from "./math";

export interface Point {
  x: number;
  y: number;
}

/** A silhouette = a radial profile r(theta) plus a pose. */
export interface Silhouette {
  radii: number[];
  rot: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export const angles = Array.from({ length: PROFILE_SAMPLES }, (_, i) => (i / PROFILE_SAMPLES) * TAU);
export const cosVals = angles.map(Math.cos);
export const sinVals = angles.map(Math.sin);

export const cloneSilhouette = (s: Silhouette): Silhouette => ({ ...s, radii: s.radii.slice() });

export const createSilhouette = (
  name: ProfileName,
  pose: Partial<Omit<Silhouette, "radii">> = {},
): Silhouette => ({ rot: 0, cx: 0, cy: 0, sx: 1, sy: 1, ...pose, radii: profiles[name].slice() });

export const createCircle = (
  radius: number,
  pose: Partial<Omit<Silhouette, "radii">> = {},
): Silhouette => ({
  rot: 0, cx: 0, cy: 0, sx: 1, sy: 1, ...pose,
  radii: new Array<number>(PROFILE_SAMPLES).fill(radius),
});

/** Interpolate two silhouettes. `out` is reused to avoid allocations. */
export function blend(a: Silhouette, b: Silhouette, t: number, out?: Silhouette): Silhouette {
  const dst = out ?? { radii: new Array<number>(PROFILE_SAMPLES).fill(0), rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 };
  for (let i = 0; i < PROFILE_SAMPLES; i++) dst.radii[i] = lerp(a.radii[i], b.radii[i], t);
  let dRot = b.rot - a.rot;
  while (dRot > Math.PI) dRot -= TAU;
  while (dRot < -Math.PI) dRot += TAU;
  dst.rot = a.rot + dRot * t;
  dst.cx = lerp(a.cx, b.cx, t);
  dst.cy = lerp(a.cy, b.cy, t);
  dst.sx = lerp(a.sx, b.sx, t);
  dst.sy = lerp(a.sy, b.sy, t);
  return dst;
}

/** Projects a silhouette to screen points. `scale` = ball radius in viewBox units. */
export function toPoints(s: Silhouette, scale: number, out?: Point[]): Point[] {
  const points = out && out.length === PROFILE_SAMPLES
    ? out
    : Array.from({ length: PROFILE_SAMPLES }, () => ({ x: 0, y: 0 }));
  const cr = Math.cos(s.rot);
  const sr = Math.sin(s.rot);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const r = s.radii[i];
    const x = r * cosVals[i];
    const y = r * sinVals[i];
    const rx = x * cr - y * sr;
    const ry = x * sr + y * cr;
    points[i].x = (rx * s.sx + s.cx) * scale;
    points[i].y = (ry * s.sy + s.cy) * scale;
  }
  return points;
}

/** Closed point loop -> Catmull-Rom cubic SVG path. */
export function closedPath(pts: Point[], tension = 1 / 6): string {
  const n = pts.length;
  if (n < 3) return "";
  let d = `M${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d +=
      `C${r2(p1.x + (p2.x - p0.x) * tension)} ${r2(p1.y + (p2.y - p0.y) * tension)} ` +
      `${r2(p2.x - (p3.x - p1.x) * tension)} ${r2(p2.y - (p3.y - p1.y) * tension)} ` +
      `${r2(p2.x)} ${r2(p2.y)}`;
  }
  return `${d} Z`;
}

/** Arbitrary polygon -> radial profile by raycasting from (cx, cy). */
export function profileFromPolygon(poly: Point[], cx: number, cy: number): number[] {
  const radii = new Array<number>(PROFILE_SAMPLES).fill(0);
  const n = poly.length;
  for (let k = 0; k < PROFILE_SAMPLES; k++) {
    const dx = cosVals[k];
    const dy = sinVals[k];
    let best = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const px = a.x - cx;
      const py = a.y - cy;
      const t = (px * ey - py * ex) / den;
      const u = (px * dy - py * dx) / den;
      if (t > best && u >= 0 && u <= 1) best = t;
    }
    radii[k] = best;
  }
  return radii;
}

/** Convex hull of two circles. */
export function hullOfCircles(
  x1: number, y1: number, r1: number, x2: number, y2: number, r2v: number, steps = 96,
): Point[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.max(Math.hypot(dx, dy), 1e-6);
  const base = Math.atan2(dy, dx);
  const spread = Math.acos(clamp((r1 - r2v) / dist, -1, 1));
  const pts: Point[] = [];
  const half = steps / 2;
  for (let i = 0; i <= Math.floor(half); i++) {
    const a = base + spread + ((TAU - 2 * spread) * i) / half;
    pts.push({ x: x1 + Math.cos(a) * r1, y: y1 + Math.sin(a) * r1 });
  }
  for (let i = 0; i <= Math.floor(half); i++) {
    const a = base - spread + (2 * spread * i) / half;
    pts.push({ x: x2 + Math.cos(a) * r2v, y: y2 + Math.sin(a) * r2v });
  }
  return pts;
}

/** Radius of a profile in an arbitrary direction, interpolating neighbouring samples. */
export function radiusAtAngle(radii: readonly number[], angle: number): number {
  const n = radii.length;
  const t = ((((angle / TAU) % 1) + 1) % 1) * n;
  const i = Math.floor(t);
  return lerp(radii[i % n], radii[(i + 1) % n], t - i);
}

export function superellipseProfile(n: number, sx = 1, sy = 1): number[] {
  return Array.from({ length: PROFILE_SAMPLES }, (_, i) => {
    const c = Math.pow(Math.abs(cosVals[i] / sx), n);
    const s = Math.pow(Math.abs(sinVals[i] / sy), n);
    return Math.pow(c + s, -1 / n);
  });
}

export interface CircleDef {
  x: number;
  y: number;
  r: number;
}

export function unionOfCirclesProfile(circles: CircleDef[]): number[] {
  const out = new Array<number>(PROFILE_SAMPLES).fill(0);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const dx = cosVals[i];
    const dy = sinVals[i];
    let best = 0;
    for (const c of circles) {
      const b = dx * c.x + dy * c.y;
      const disc = b * b - (c.x * c.x + c.y * c.y - c.r * c.r);
      if (disc < 0) continue;
      const t = b + Math.sqrt(disc);
      if (t > best) best = t;
    }
    out[i] = best;
  }
  return out;
}

/** Polygon with rounded corners via Minkowski sum. */
export function roundedPolygon(verts: Point[], rc: number, arcSteps = 10): Point[] {
  const n = verts.length;
  const out: Point[] = [];
  const normal = (a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(Math.hypot(dx, dy), 1);
    return Math.atan2(-dx / len, dy / len);
  };
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const cur = verts[i];
    const next = verts[(i + 1) % n];
    const a0 = normal(prev, cur);
    const a1 = normal(cur, next);
    let d = a1 - a0;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    for (let k = 0; k <= arcSteps; k++) {
      const a = a0 + (d * k) / arcSteps;
      out.push({ x: cur.x + Math.cos(a) * rc, y: cur.y + Math.sin(a) * rc });
    }
  }
  return out;
}

export function regularPolygonProfile(sides: number, radius: number, rc: number, rotationDeg = 0): number[] {
  const rot = (rotationDeg * Math.PI) / 180;
  const verts = Array.from({ length: sides }, (_, i) => {
    const a = rot + (i / sides) * TAU;
    return { x: Math.cos(a) * (radius - rc), y: Math.sin(a) * (radius - rc) };
  });
  return profileFromPolygon(roundedPolygon(verts, rc), 0, 0);
}

export function polyPath(pts: Point[], scale = 1): string {
  if (pts.length < 3) return "";
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    d += `${i === 0 ? "M" : "L"}${r2(pts[i].x * scale)} ${r2(pts[i].y * scale)}`;
  }
  return `${d} Z`;
}

export function capsulePath(w: number, h: number): string {
  const hw = Math.max(w, 0.01) / 2;
  const hh = Math.max(h, 0.01) / 2;
  const r = Math.min(hw, hh);
  return (
    `M${r2(-hw)} ${r2(-hh + r)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw + r)} ${r2(-hh)}` +
    `L${r2(hw - r)} ${r2(-hh)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw)} ${r2(-hh + r)}` +
    `L${r2(hw)} ${r2(hh - r)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw - r)} ${r2(hh)}` +
    `L${r2(-hw + r)} ${r2(hh)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw)} ${r2(hh - r)}Z`
  );
}

/** Low-pass filter a radial profile to remove sharp corners. */
export function smoothProfile(radii: number[], passes = 1): number[] {
  let out = radii.slice();
  const n = radii.length;
  for (let p = 0; p < passes; p++) {
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      next[i] = out[(i - 1 + n) % n] * 0.25 + out[i] * 0.5 + out[(i + 1) % n] * 0.25;
    }
    out = next;
  }
  return out;
}
