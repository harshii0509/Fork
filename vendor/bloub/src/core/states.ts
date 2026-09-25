import {
  DOT_PEAK, DOT_R, DOT_X, NOTIF_ANGLE, NOTIF_DIST, NOTIF_MARGIN, NOTIF_POP, NOTIF_R,
  getParticles, rings, swoosh, type ArcSpec, type DotRender,
} from "./decor";
import { REST_GAZE } from "./face";
import { TAU, clamp, easeInOutCubic, easeOutCubic, lerp } from "./math";
import { basePose, eyePair, type Pose } from "./pose";
import {
  createCircle, hullOfCircles, polyPath, profileFromPolygon, type Silhouette,
} from "./shape";
import type { BloubState } from "./types";

const BAR_UPRIGHT_CY = -0.1875;
const barUprightProfile = profileFromPolygon(
  hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075), 0, BAR_UPRIGHT_CY,
);
const barItalicProfile = profileFromPolygon(
  hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0,
);

const bar = (radii: number[], p: Partial<Omit<Silhouette, "radii">>): Silhouette => ({
  rot: 0, cx: 0, cy: 0, sx: 1, sy: 1, ...p, radii: radii.slice(),
});

const tearPath = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012));
const TRI_ORBIT = 0.213;

export interface StateDef {
  id: BloubState;
  /** Default seconds a one-shot state plays before the controller returns to idle. */
  duration: number;
  minDuration?: number;
  /** Cross-fade seconds when entering this state. */
  morph: number;
  blinkIn: boolean;
  /** Body silhouette is replaced by the selected shape. */
  baseBody: boolean;
  /** Face is replaced by the selected expression. */
  baseFace: boolean;
  pose: (t: number, shape?: number[] | null) => Pose;
}

function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0;
  return clamp(k * 2);
}

const def = (d: StateDef): StateDef => d;

export const states: StateDef[] = [
  def({ id: "idle", duration: 2.4, morph: 0.45, blinkIn: false, baseFace: true, baseBody: true, pose: () => basePose() }),
  def({
    id: "thinking", duration: 2.6, morph: 0.4, baseFace: false, baseBody: false, blinkIn: true,
    pose: (t) => {
      const mid = dotPulse(t, 1);
      const emerge = 0.3 + 0.7 * easeOutCubic(clamp(t / 0.3));
      return basePose({
        sil: createCircle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1] }),
        eyeAlpha: 0,
        dots: [0, 2].map((i): DotRender => {
          const k = dotPulse(t, i);
          return { x: DOT_X[i] * emerge, y: 0, r: DOT_R * (1 + (DOT_PEAK - 1) * k), opacity: 0.55 + 0.45 * k };
        }),
      });
    },
  }),
  def({
    id: "wink", duration: 1.6, morph: 0.3, blinkIn: true, baseFace: false, baseBody: true,
    pose: () => basePose({
      gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
      split: 16.25,
      eyes: [{ w: 0.236, h: 0.464, open: 1, tilt: 0 }, { w: 0.447, h: 0.089, open: 1, tilt: 0 }],
    }),
  }),
  def({
    id: "wide", duration: 1.8, morph: 0.55, blinkIn: true, baseFace: false, baseBody: true,
    pose: () => basePose({ gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 }, split: 18.43, eyes: eyePair(0.356, 0.875) }),
  }),
  def({
    id: "alert", duration: 2.4, minDuration: 2, morph: 0.45, baseFace: false, baseBody: false, blinkIn: false,
    pose: (t) => {
      const p = clamp(t / 1.5);
      const travel = easeInOutCubic(p) * 0.82 - 0.087;
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0;
      const x = travel * (1 - back) + 0.1 * back;
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005;
      const tilt = (17.7 * Math.PI) / 180;
      return basePose({
        sil: bar(barItalicProfile, { rot: tilt, cx: x, cy: -0.325 - buzz }),
        eyeAlpha: 0,
        dots: [{
          x: x - Math.sin(tilt) * 0.58,
          y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8,
          r: 0.118, d: tearPath, rot: (tilt * 180) / Math.PI, opacity: 1,
        }],
      });
    },
  }),
  def({
    id: "notify", duration: 2.2, morph: 0.5, blinkIn: true, baseFace: false, baseBody: true,
    pose: (t) => {
      const p = clamp(t / 0.45);
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35);
      const r = NOTIF_R * (p < 1 ? pop : 1);
      const a = (NOTIF_ANGLE * Math.PI) / 180;
      return basePose({
        gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
        split: 18.89,
        eyes: eyePair(0.505, 0.498),
        notif: { x: Math.cos(a) * NOTIF_DIST, y: Math.sin(a) * NOTIF_DIST, r, notch: r + NOTIF_MARGIN },
      });
    },
  }),
  def({
    id: "exclaim", duration: 2, morph: 0.45, baseFace: false, baseBody: false, blinkIn: false,
    pose: () => basePose({
      sil: bar(barUprightProfile, { cy: BAR_UPRIGHT_CY }),
      eyeAlpha: 0,
      dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }],
    }),
  }),
  def({
    id: "sleep", duration: 2.4, morph: 0.5, baseFace: false, baseBody: true, blinkIn: false,
    pose: (t) => basePose({
      sil: createCircle(1, { sx: 0.1585, sy: 0.1585, cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }),
      eyeAlpha: 0,
    }),
  }),
  def({
    id: "play", duration: 2, morph: 0.5, baseFace: false, baseBody: true, blinkIn: true,
    pose: (t) => {
      const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5);
      const arcs: ArcSpec[] = swoosh.map((s, i) => ({
        id: `sw${i}`, seed: { ...s, cx: 0.45 - t * 0.42 }, t, opacity: fade,
      }));
      return basePose({
        sil: createCircle(1, { cy: TRI_ORBIT }),
        gaze: { yaw: 12, pitch: -8, roll: -6 },
        split: 15,
        eyes: eyePair(0.18, 0.34),
        arcs,
      });
    },
  }),
  def({
    id: "orbit", duration: 3.4, minDuration: 2.5, morph: 0.6, baseFace: false, baseBody: true, blinkIn: false,
    pose: (t) => {
      const rot = lerp(0, TAU / 4, clamp((t - 1.1) / 0.6));
      const back = easeInOutCubic(clamp((t - 1.6) / 0.9));
      const sil = createCircle(1, { rot, cy: TRI_ORBIT * (1 - back) });
      const fade = clamp(t / 0.8) * clamp((3.6 - t) / 0.9);
      const arcs: ArcSpec[] = rings.map((seed, i) => ({
        id: `rg${i}`, seed, t, opacity: fade * clamp((t - i * 0.13) / 0.3),
      }));
      return basePose({
        sil,
        gaze: { yaw: REST_GAZE.yaw + Math.sin(t * 6.5) * 65 * (1 - back), pitch: -4 + back * 32, roll: -13 },
        eyes: eyePair(0.18, 0.34 + back * 0.07),
        arcs,
      });
    },
  }),
  def({
    id: "swirl", duration: 1.3, minDuration: 1.3, morph: 0.3, baseFace: true, baseBody: true, blinkIn: true,
    pose: (t) => basePose({
      arcs: [0, 1, 2].map((i): ArcSpec => ({
        id: `sw${i}`, seed: rings[i], t,
        opacity: clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34),
      })),
    }),
  }),
  def({
    id: "burst", duration: 2.6, minDuration: 2.4, morph: 0.4, baseFace: false, baseBody: true, blinkIn: false,
    pose: (t) => {
      const collapse = 1 - clamp(t / 0.35);
      const regrow = clamp((t - 1) / 0.2);
      const scale = collapse + (1 - collapse) * regrow;
      return basePose({
        sil: createCircle(1, { sx: scale, sy: scale }),
        eyeAlpha: clamp((t - 1.85) / 0.4),
        dots: getParticles(t, 1),
        dotsBehind: true,
      });
    },
  }),
];

export const stateById = Object.fromEntries(states.map((s) => [s.id, s])) as Record<BloubState, StateDef>;
