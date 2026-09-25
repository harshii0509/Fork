import { eyePoses, type HeadGaze } from "./face";
import { expressions } from "./expression";
import type { EyeCfg, Pose } from "./pose";
import { radiusAtAngle, toPoints, type Point, type Silhouette } from "./shape";
import { states, type StateDef } from "./states";
import type { BloubExpression, BloubState } from "./types";
import type { BotExpression } from "./expression";

/**
 * Computes, per (shape, state, expression), the offset that keeps both eyes
 * inside the body outline through the whole animation. Ported 1:1 from the
 * Flutter engine (French identifiers kept out; names translated).
 */

const R = 100;
const DRIFT_YAW = 5.5 + 1.6;
const DRIFT_PITCH = 4.2 + 1.3;
const DRIFT_X = 0.006;
const DRIFT_Y = 0.007;
const FLOAT_MARGIN = Math.hypot(DRIFT_X, DRIFT_Y) * R;

export interface Vec2 {
  x: number;
  y: number;
}
const ZERO: Vec2 = { x: 0, y: 0 };

interface Face {
  gaze: HeadGaze;
  split: number;
  eyes: EyeCfg[];
}

interface Footprint {
  x: number;
  y: number;
  ax: number;
  ay: number;
  r: number;
  m: [number, number, number, number];
}

function footprints(face: Face, sil: Silhouette, radii: number[]): Footprint[] {
  const out: Footprint[] = [];
  const poses = eyePoses(face.gaze, R, face.split);
  for (let i = 0; i < 2; i++) {
    const e = poses[i];
    if (e.depth <= 0.02) continue;
    const cfg = face.eyes[i];
    const phi = (cfg.tilt * Math.PI) / 180;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const ax = e.a * cp + e.c * sp;
    const ay = e.b * cp + e.d * sp;
    const cx = -e.a * sp + e.c * cp;
    const cy = -e.b * sp + e.d * cp;
    const hw = Math.max(cfg.w * R, 0.01) / 2;
    const hh = Math.max(cfg.h * R, 0.01) / 2;
    const r = Math.min(hw, hh);
    const long = hh > hw;
    const half = long ? hh - r : hw - r;
    const fit = radiusAtAngle(radii, Math.atan2(e.y, e.x) - sil.rot);
    out.push({
      x: e.x * fit, y: e.y * fit,
      ax: (long ? cx : ax) * half, ay: (long ? cy : ay) * half,
      r, m: [ax, ay, cx, cy],
    });
  }
  return out;
}

function approach(pts: Point[], x0: number, y0: number, x1: number, y1: number) {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len2 = sx * sx + sy * sy;
  let best = Infinity;
  let vx = 0;
  let vy = 0;
  for (const p of pts) {
    let t = len2 > 0 ? ((p.x - x0) * sx + (p.y - y0) * sy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + t * sx - p.x;
    const ey = y0 + t * sy - p.y;
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      vx = ex;
      vy = ey;
    }
  }
  const d = Math.sqrt(best);
  return { d, ux: d > 1e-9 ? vx / d : 0, uy: d > 1e-9 ? vy / d : 0 };
}

function worstMargin(pts: Point[], emps: Footprint[], tx: number, ty: number): number {
  let margin = Infinity;
  for (const e of emps) {
    const x = e.x + tx;
    const y = e.y + ty;
    const a = approach(pts, x - e.ax, y - e.ay, x + e.ax, y + e.ay);
    const [m0, m1, m2, m3] = e.m;
    const radius =
      e.r * Math.sqrt((m0 * a.ux + m1 * a.uy) ** 2 + (m2 * a.ux + m3 * a.uy) ** 2) + FLOAT_MARGIN;
    margin = Math.min(margin, a.d - radius);
  }
  return margin;
}

interface Trial {
  footprints: Footprint[];
  reference: Footprint[];
  contour: Point[];
  calContour: Point[];
}

const DIRECTIONS = 12;
const BISECTIONS = 8;

function solve(trials: Trial[]): Vec2 {
  if (trials.length === 0) return ZERO;

  const marginFn = (tx: number, ty: number) => {
    let m = Infinity;
    for (const t of trials) m = Math.min(m, worstMargin(t.contour, t.footprints, tx, ty));
    return m;
  };

  let required = Infinity;
  for (const t of trials) required = Math.min(required, worstMargin(t.calContour, t.reference, 0, 0));

  let mx = 0;
  let my = 0;
  const emps = trials[0].footprints;
  for (const e of emps) {
    mx -= e.x / emps.length;
    my -= e.y / emps.length;
  }
  const reach = Math.max(0.35 * R, Math.hypot(mx, my) * 1.25);
  required = Math.min(required, marginFn(mx, my));

  const start = marginFn(0, 0);
  if (start >= required && start >= 0) return ZERO;
  const target = Math.max(required, 0);

  let bestX = 0;
  let bestY = 0;
  let bestNorm = Infinity;
  let fallbackX = 0;
  let fallbackY = 0;
  let fallback = start;

  for (let d = 0; d < DIRECTIONS; d++) {
    const a = (d / DIRECTIONS) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (marginFn(ux * reach, uy * reach) < target) {
      for (const k of [0.3, 0.6, 1]) {
        const m = marginFn(ux * reach * k, uy * reach * k);
        if (m > fallback) {
          fallback = m;
          fallbackX = ux * reach * k;
          fallbackY = uy * reach * k;
        }
      }
      continue;
    }
    let lo = 0;
    let hi = reach;
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      if (marginFn(ux * mid, uy * mid) >= target) hi = mid;
      else lo = mid;
    }
    if (hi < bestNorm) {
      bestNorm = hi;
      bestX = ux * hi;
      bestY = uy * hi;
    }
  }

  const x = bestNorm === Infinity ? fallbackX : bestX;
  const y = bestNorm === Infinity ? fallbackY : bestY;
  return { x: Number((x / R).toFixed(6)), y: Number((y / R).toFixed(6)) };
}

function faceOf(def: StateDef, pose: Pose, expr: BotExpression | null): Face {
  return def.baseFace && expr ? { gaze: expr.gaze, split: expr.split, eyes: expr.eyes } : pose;
}

function sampleTimes(def: StateDef): number[] {
  const sig = (p: Pose) =>
    [p.gaze.yaw, p.gaze.pitch, p.gaze.roll, p.split,
      ...p.eyes.flatMap((e) => [e.w, e.h, e.tilt, e.open]),
      p.sil.rot, p.sil.cx, p.sil.cy, p.sil.sx, p.sil.sy].join("|");
  if (sig(def.pose(0, null)) === sig(def.pose(def.duration, null))) return [0];
  const n = 3;
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * def.duration);
}

function offsetFor(def: StateDef, radii: number[], expr: BotExpression | null): Vec2 {
  const trials: Trial[] = [];
  for (const t of sampleTimes(def)) {
    const pose = def.pose(t, radii);
    const contour = toPoints({ ...pose.sil, radii }, R);
    const calContour = toPoints(pose.sil, R);
    const v = faceOf(def, pose, expr);
    for (const dy of [-DRIFT_YAW, DRIFT_YAW]) {
      for (const dp of [-DRIFT_PITCH, DRIFT_PITCH]) {
        const corner: Face = {
          gaze: { yaw: v.gaze.yaw + dy, pitch: v.gaze.pitch + dp, roll: v.gaze.roll },
          split: v.split,
          eyes: v.eyes,
        };
        trials.push({
          footprints: footprints(corner, pose.sil, radii),
          reference: footprints(corner, pose.sil, pose.sil.radii),
          contour,
          calContour,
        });
      }
    }
  }
  return solve(trials);
}

const stateDefs = new Map<BloubState, StateDef>(states.map((s) => [s.id, s]));
const cache = new WeakMap<number[], Map<string, Vec2>>();

/** Eye offset for (shape radii, state, expression). Memoised lazily per combination. */
export function eyeOffset(radii: number[] | null, state: BloubState, expr: BloubExpression | null): Vec2 {
  if (!radii) return ZERO;
  const def = stateDefs.get(state)!;
  if (!def.baseBody) return ZERO;
  const key = `${state}|${def.baseFace ? (expr ?? "") : ""}`;
  let per = cache.get(radii);
  if (!per) cache.set(radii, (per = new Map()));
  let v = per.get(key);
  if (!v) {
    v = offsetFor(def, radii, def.baseFace && expr ? expressions[expr] : null);
    per.set(key, v);
  }
  return v;
}
