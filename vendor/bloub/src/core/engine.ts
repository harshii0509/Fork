import { arcRender, type ArcRender, type ArcSpec, type DotRender } from "./decor";
import { eyeOffset, type Vec2 } from "./eyefit";
import { blendExpression, lerpEyeCfg, type BotExpression } from "./expression";
import { eyePoses, getBlinkScale, getLiveliness, type HeadGaze } from "./face";
import { clamp, easeOutQuint, lerp, r2 } from "./math";
import { basePose, type NotifRender, type Pose } from "./pose";
import {
  blend, capsulePath, closedPath, radiusAtAngle, toPoints, type Point, type Silhouette,
} from "./shape";
import { stateById, type StateDef } from "./states";
import type { BloubState } from "./types";

export interface RenderedEye {
  d: string;
  matrix: string;
  alpha: number;
}

export interface BotFrame {
  bodyPath: string;
  bodyAlpha: number;
  eyes: RenderedEye[];
  dots: DotRender[];
  dotsBehind: boolean;
  arcs: ArcRender[];
  notif?: NotifRender;
  notch?: NotifRender;
}

export interface Look {
  yaw: number;
  pitch: number;
  mix: number;
  spin: number;
  wander: number;
}

export const NO_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };

const lerpLook = (a: Look, b: Look, t: number): Look => ({
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
  mix: lerp(a.mix, b.mix, t),
  spin: lerp(a.spin, b.spin, t),
  wander: lerp(a.wander, b.wander, t),
});

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = 1 - t;
  const dots: DotRender[] = [
    ...a.dots.map((d) => ({ ...d, opacity: d.opacity * out })),
    ...b.dots.map((d) => ({ ...d, opacity: d.opacity * t })),
  ];
  const arcs: ArcSpec[] = [
    ...a.arcs.map((r) => ({ ...r, id: `a${r.id}`, opacity: r.opacity * out })),
    ...b.arcs.map((r) => ({ ...r, id: `b${r.id}`, opacity: r.opacity * t })),
  ];
  return {
    sil: blend(a.sil, b.sil, t),
    offX: lerp(a.offX, b.offX, t),
    offY: lerp(a.offY, b.offY, t),
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t),
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEyeCfg(a.eyes[0], b.eyes[0], t), lerpEyeCfg(a.eyes[1], b.eyes[1], t)],
    eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
    bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
    dots,
    arcs,
    notif: t < 0.5 ? a.notif : b.notif,
    dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind,
  };
}

const SHAPE_MORPH = 0.45;
const LOOK_MORPH = 0.24;
const NEVER = -10;

export interface EngineInit {
  scale?: number;
  initial?: BloubState;
  shape?: number[] | null;
  expression?: BotExpression | null;
}

/**
 * Stateless-in-time mascot engine: given a clock reading `now` (seconds) it
 * returns the SVG geometry for that instant. State/shape/expression/look
 * changes are cross-faded from the moment they were requested.
 */
export class MascotEngine {
  readonly scale: number;
  private cur: BloubState;
  private prev: BloubState | null = null;
  private frozenOrigin: Pose | null = null;
  private tCur = 0;
  private tPrev = 0;
  private blinkAt = NEVER;
  private pts: Point[] = [];

  private shape: number[] | null;
  private shapePrev: number[] | null = null;
  private shapeAt = NEVER;

  private expr: BotExpression | null;
  private exprPrev: BotExpression | null = null;
  private exprAt = NEVER;

  private look: Look = NO_LOOK;
  private lookPrev: Look = NO_LOOK;
  private lookAtT = NEVER;
  private lookMorph = LOOK_MORPH;

  constructor({ scale = 100, initial = "idle", shape = null, expression = null }: EngineInit = {}) {
    this.scale = scale;
    this.cur = initial;
    this.shape = shape;
    this.expr = expression;
  }

  get state(): BloubState {
    return this.cur;
  }

  setExpression(expression: BotExpression | null, now = 0): void {
    if (expression === this.expr) return;
    this.exprPrev = this.expr;
    this.expr = expression;
    this.exprAt = now;
  }

  private exprAtTime(now: number): BotExpression | null {
    const to = this.expr;
    const from = this.exprPrev;
    if (!to || !from) return to;
    const k = (now - this.exprAt) / SHAPE_MORPH;
    return k >= 1 ? to : blendExpression(from, to, easeOutQuint(clamp(k)));
  }

  setShape(radii: number[] | null, now = 0): void {
    if (radii === this.shape) return;
    this.shapePrev = this.shape;
    this.shape = radii;
    this.shapeAt = now;
  }

  private shapeAtTime(now: number): number[] | null {
    const to = this.shape;
    const from = this.shapePrev;
    if (!to || !from) return to;
    const k = (now - this.shapeAt) / SHAPE_MORPH;
    if (k >= 1) return to;
    const t = easeOutQuint(clamp(k));
    return to.map((v, i) => lerp(from[i], v, t));
  }

  setLook(look: Look | null, now: number, morph = LOOK_MORPH): void {
    if (look && ![look.yaw, look.pitch, look.mix, look.spin, look.wander].every(Number.isFinite)) return;
    this.lookPrev = this.lookAtTime(now);
    this.look = look ?? NO_LOOK;
    this.lookAtT = now;
    this.lookMorph = morph;
  }

  private lookAtTime(now: number): Look {
    const k = (now - this.lookAtT) / this.lookMorph;
    return k >= 1 ? this.look : lerpLook(this.lookPrev, this.look, easeOutQuint(clamp(k)));
  }

  private posed(def: StateDef, t: number, shape: number[] | null, expr: BotExpression | null): Pose {
    let pose = def.pose(t, shape);
    if (def.baseBody && shape) {
      pose = { ...pose, sil: { ...pose.sil, radii: shape } };
    }
    if (def.baseFace && expr) {
      pose = { ...pose, gaze: expr.gaze, split: expr.split, eyes: expr.eyes };
    }
    return pose;
  }

  private eyeShift(now: number, state: BloubState): Vec2 {
    const along = (start: number, dur: number, a: Vec2, b: Vec2): Vec2 => {
      if (a.x === b.x && a.y === b.y) return b;
      const k = (now - start) / dur;
      if (k >= 1) return b;
      const t = easeOutQuint(clamp(k));
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    };
    const forShape = (radii: number[] | null) =>
      along(
        this.exprAt, SHAPE_MORPH,
        eyeOffset(radii, state, this.exprPrev?.id ?? null),
        eyeOffset(radii, state, this.expr?.id ?? null),
      );
    return along(this.shapeAt, SHAPE_MORPH, forShape(this.shapePrev), forShape(this.shape));
  }

  reset(id: BloubState, now: number): void {
    this.cur = id;
    this.prev = null;
    this.frozenOrigin = null;
    this.tCur = now;
    this.tPrev = now;
    this.blinkAt = NEVER;
  }

  private origin(now: number, shape: number[] | null, expr: BotExpression | null): Pose | null {
    if (this.frozenOrigin) return this.frozenOrigin;
    if (!this.prev) return null;
    return this.posed(stateById[this.prev], Math.max(0, now - this.tPrev), shape, expr);
  }

  private composedPose(now: number): Pose {
    const def = stateById[this.cur];
    const shape = this.shapeAtTime(now);
    const expr = this.exprAtTime(now);
    const pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr);
    const since = now - this.tCur;
    if (since >= def.morph) return pose;
    const origin = this.origin(now, shape, expr);
    return origin ? blendPose(origin, pose, easeOutQuint(clamp(since / def.morph))) : pose;
  }

  setState(id: BloubState, now: number): void {
    if (id === this.cur) return;
    const morph = stateById[this.cur].morph;
    const midFade = this.prev !== null && now - this.tCur < morph;
    this.frozenOrigin = midFade ? this.composedPose(now) : null;
    this.prev = this.cur;
    this.tPrev = this.tCur;
    this.cur = id;
    this.tCur = now;
    if (stateById[id].blinkIn) this.blinkAt = now;
  }

  sample(now: number): BotFrame {
    const S = this.scale;
    const def = stateById[this.cur];
    const shape = this.shapeAtTime(now);
    const expr = this.exprAtTime(now);
    let pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr);
    let shift = this.eyeShift(now, this.cur);

    const since = now - this.tCur;
    const origin = since < def.morph ? this.origin(now, shape, expr) : null;
    if (origin) {
      const ratio = easeOutQuint(clamp(since / def.morph));
      pose = blendPose(origin, pose, ratio);
      if (this.prev) {
        const before = this.eyeShift(now, this.prev);
        shift = { x: lerp(before.x, shift.x, ratio), y: lerp(before.y, shift.y, ratio) };
      }
    }

    const alive = pose.eyeAlpha > 0.01;
    const look = this.lookAtTime(now);
    const life = getLiveliness(now, { wander: alive ? look.wander : 0, blink: alive });

    const gaze: HeadGaze = {
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
      roll: pose.gaze.roll + life.dRoll,
    };

    const forced = clamp((now - this.blinkAt) / 0.2);
    const forcedLid = forced < 1 ? Math.abs(forced * 2 - 1) : 1;
    const lid = Math.min(life.lid, forcedLid);

    const offX = pose.offX + life.driftX;
    const offY = pose.offY + life.driftY;

    const sil: Silhouette = {
      radii: pose.sil.radii,
      rot: pose.sil.rot,
      cx: pose.sil.cx + offX,
      cy: pose.sil.cy + offY,
      sx: pose.sil.sx,
      sy: pose.sil.sy * life.breath,
    };
    this.pts = toPoints(sil, S, this.pts);
    const bodyPath = closedPath(this.pts);

    const bodyRadius = (x: number, y: number) =>
      radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot);

    const eyes: RenderedEye[] = [];
    if (alive) {
      const poses = eyePoses(gaze, S, pose.split);
      for (let i = 0; i < 2; i++) {
        const e = poses[i];
        if (e.depth <= 0.02) continue;
        const cfg = pose.eyes[i];
        const fit = bodyRadius(e.x, e.y);
        const phi = (cfg.tilt * Math.PI) / 180;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        const ax = e.a * cp + e.c * sp;
        const ay = e.b * cp + e.d * sp;
        const cx2 = -e.a * sp + e.c * cp;
        const cy2 = -e.b * sp + e.d * cp;
        const k = getBlinkScale(Math.min(lid, cfg.open));
        eyes.push({
          d: capsulePath(cfg.w * S, cfg.h * S),
          matrix: `matrix(${r2(ax)},${r2(ay * k)},${r2(cx2)},${r2(cy2 * k)},${r2(e.x * fit + (offX + shift.x) * S)},${r2(e.y * fit + (offY + shift.y) * S)})`,
          alpha: pose.eyeAlpha * clamp(e.depth / 0.12),
        });
      }
    }

    const dots: DotRender[] = [];
    for (const p of pose.dots) {
      if (p.opacity > 0.01 && p.r > 0.0005) {
        dots.push({ ...p, x: (p.x + offX) * S, y: (p.y + offY) * S, r: p.r * S });
      }
    }

    let notif: NotifRender | undefined;
    let notch: NotifRender | undefined;
    if (pose.notif) {
      const fit = bodyRadius(pose.notif.x, pose.notif.y);
      const nx = (pose.notif.x * fit + offX) * S;
      const ny = (pose.notif.y * fit + offY) * S;
      notif = { x: nx, y: ny, r: pose.notif.r * S, notch: pose.notif.notch };
      notch = { x: nx, y: ny, r: pose.notif.notch * S, notch: pose.notif.notch };
    }

    const arcs: ArcRender[] = [];
    for (const a of pose.arcs) {
      if (a.opacity > 0.01) arcs.push(arcRender(a.seed, a.t, S, a.id, a.opacity));
    }

    return { bodyPath, bodyAlpha: pose.bodyAlpha, eyes, dots, dotsBehind: pose.dotsBehind, arcs, notif, notch };
  }
}

export { basePose };
