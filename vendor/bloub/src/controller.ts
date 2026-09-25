import { animate, mix, type AnimationPlaybackControls } from "motion";
import { MascotEngine, NO_LOOK, type BotFrame, type Look } from "./core/engine";
import { expressions } from "./core/expression";
import { shapeProfiles } from "./core/skins";
import { stateById } from "./core/states";
import {
  PREDEFINED_COLORS,
  type BloubExpression, type BloubPredefinedColor, type BloubShape, type BloubState,
} from "./core/types";
import { svgToPngBlob } from "./renderer";

/** A preset name ("blue") or any CSS hex color ("#2c90ff"). */
export type BloubColor = BloubPredefinedColor | `#${string}`;

export interface BloubControllerOptions {
  shape?: BloubShape;
  color?: BloubColor;
  state?: BloubState;
  expression?: BloubExpression | null;
}

export interface LookAtOptions {
  yaw: number;
  pitch: number;
  /** 0 = ignore, 1 = fully override the state's scripted gaze. */
  mix?: number;
}

export interface TemporaryStateOptions {
  /** Seconds. Defaults to the state's natural duration. */
  duration?: number;
  fallback?: BloubState;
}

const resolveColor = (c: BloubColor): string => (c.startsWith("#") ? c : PREDEFINED_COLORS[c as BloubPredefinedColor] ?? "#000000");
const GAZE_SPRING = { type: "spring", stiffness: 260, damping: 28 } as const;
const COLOR_TWEEN = { duration: 0.3, ease: "easeOut" } as const;

export type Listener = () => void;

/**
 * Drives a Bloub: its shape, color, animated state, expression and gaze.
 * Framework-agnostic — pair it with `mountBloub()` (vanilla) or `<Bloub />` (React).
 */
export class BloubController {
  private engine: MascotEngine;
  private listeners = new Set<Listener>();
  private t0 = performance.now();
  private disposed = false;
  private playToken = 0;
  private exprToken = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  private _shape: BloubShape;
  private _color: BloubColor;
  private _state: BloubState;
  private _expression: BloubExpression | null;

  private colorTo: string;
  private colorAnim?: AnimationPlaybackControls;

  private look: Look = NO_LOOK;
  private gazeAnim?: AnimationPlaybackControls;

  /** Bumped on every change that should force a repaint even when the clock is paused. */
  version = 0;

  constructor({ shape = "circle", color = "black", state = "idle", expression = null }: BloubControllerOptions = {}) {
    this._shape = shape;
    this._color = color;
    this._state = state;
    this._expression = expression;
    this.colorTo = resolveColor(color);
    this.engine = new MascotEngine({
      scale: 100,
      initial: state,
      shape: shapeProfiles[shape],
      expression: expression ? expressions[expression] : null,
    });
  }

  /** Seconds since this controller was created. */
  get elapsed(): number {
    return (performance.now() - this.t0) / 1000;
  }
  get shape() { return this._shape; }
  get color() { return this._color; }
  get state() { return this._state; }
  get expression() { return this._expression; }

  /** Current paint color, mid-transition when the color was just changed. */
  private currentColor = "";
  get paint(): string {
    return this.currentColor || this.colorTo;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Geometry for the current instant (or an explicit `now`, in seconds). */
  sample(now = this.elapsed): BotFrame {
    return this.engine.sample(now);
  }

  setShape(shape: BloubShape): void {
    if (this._shape === shape) return;
    this._shape = shape;
    this.engine.setShape(shapeProfiles[shape], this.elapsed);
    this.notify();
  }

  setColor(color: BloubColor): void {
    if (this._color === color) return;
    this._color = color;
    const from = this.paint;
    const to = resolveColor(color);
    this.colorAnim?.stop();
    this.colorTo = to;
    const mixer = mix(from, to) as (p: number) => string;
    this.colorAnim = animate(0, 1, {
      ...COLOR_TWEEN,
      onUpdate: (p) => {
        this.currentColor = mixer(p);
      },
      onComplete: () => {
        this.currentColor = to;
      },
    });
    this.notify();
  }

  /** Sets a permanent state that loops until changed. */
  setState(state: BloubState): void {
    if (this._state === state) return;
    this.playToken++;
    this._state = state;
    this.engine.setState(state, this.elapsed);
    this.notify();
  }

  /** Plays a state, then returns to `fallback` (default idle). */
  playStateTemporarily(state: BloubState, { duration, fallback = "idle" }: TemporaryStateOptions = {}): void {
    if (this._state === state) return;
    this._state = state;
    this.engine.setState(state, this.elapsed);
    this.notify();
    const token = ++this.playToken;
    this.later((duration ?? stateById[state].duration) * 1000, () => {
      if (token === this.playToken) this.setState(fallback);
    });
  }

  setExpression(expression: BloubExpression | null): void {
    if (this._expression === expression) return;
    this.exprToken++;
    this._expression = expression;
    this.engine.setExpression(expression ? expressions[expression] : null, this.elapsed);
    this.notify();
  }

  playExpressionTemporarily(
    expression: BloubExpression,
    { duration, fallback = null }: { duration: number; fallback?: BloubExpression | null },
  ): void {
    if (this._expression === expression) return;
    this._expression = expression;
    this.engine.setExpression(expressions[expression], this.elapsed);
    this.notify();
    const token = ++this.exprToken;
    this.later(duration * 1000, () => {
      if (token === this.exprToken) this.setExpression(fallback);
    });
  }

  /** Points the gaze (degrees, -90..90). Springs toward the target and can be retargeted every pointer move. */
  lookAt({ yaw, pitch, mix: m = 1 }: LookAtOptions): void {
    this.steerGaze({
      yaw: Math.max(-90, Math.min(90, yaw)),
      pitch: Math.max(-90, Math.min(90, pitch)),
      mix: m,
      spin: 0,
      wander: 0,
    });
  }

  /** Hands the gaze back to the avatar's own idle drift. */
  resetGaze(): void {
    this.steerGaze(NO_LOOK);
  }

  private steerGaze(to: Look) {
    const from = this.look;
    // Entering from an un-steered gaze: start at the target direction with mix 0, so only the mix fades in.
    const start = from.mix === 0 ? { ...from, yaw: to.yaw, pitch: to.pitch } : from;
    this.gazeAnim?.stop();
    this.gazeAnim = animate(0, 1, {
      ...GAZE_SPRING,
      onUpdate: (p) => {
        this.look = {
          yaw: start.yaw + (to.yaw - start.yaw) * p,
          pitch: start.pitch + (to.pitch - start.pitch) * p,
          mix: start.mix + (to.mix - start.mix) * p,
          spin: 0,
          wander: start.wander + (to.wander - start.wander) * p,
        };
        this.engine.setLook(this.look, this.elapsed, 0.0001);
      },
      onComplete: () => {
        this.look = to;
        this.engine.setLook(to, this.elapsed, 0.0001);
      },
    });
    this.notify();
  }

  /** Renders the current pose to a PNG blob. */
  exportAsPng({ size = 512 }: { size?: number } = {}): Promise<Blob> {
    return svgToPngBlob(this.sample(), this.paint, size);
  }

  private later(ms: number, fn: () => void) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }

  /** Undo a dispose (React StrictMode re-runs effects on the same instance). */
  revive(): void {
    this.disposed = false;
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.colorAnim?.stop();
    this.gazeAnim?.stop();
    this.listeners.clear();
  }
}
