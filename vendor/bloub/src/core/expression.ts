import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from "./face";
import { lerp } from "./math";
import type { EyeCfg } from "./pose";
import type { BloubExpression } from "./types";

export interface BotExpression {
  id: BloubExpression;
  gaze: HeadGaze;
  split: number;
  eyes: [EyeCfg, EyeCfg];
}

const eye = (w: number, h: number, tilt = 0, open = 1): EyeCfg => ({ w, h, tilt, open });
const pair = (w: number, h: number, tilt = 0, open = 1): [EyeCfg, EyeCfg] => [
  eye(w, h, tilt, open),
  eye(w, h, -tilt, open),
];
const g = (yaw: number, pitch: number, roll: number): HeadGaze => ({ yaw, pitch, roll });

export const expressions: Record<BloubExpression, BotExpression> = {
  neutral: { id: "neutral", gaze: REST_GAZE, split: EYE_SPLIT, eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)] },
  attentif: { id: "attentif", gaze: g(4, 5, -4), split: 16, eyes: pair(0.21, 0.44) },
  surprised: { id: "surprised", gaze: g(3, -3, 0), split: 19, eyes: pair(0.45, 0.47) },
  excited: { id: "excited", gaze: g(6, -14, 0), split: 19.5, eyes: pair(0.4, 0.56, -10) },
  happy: { id: "happy", gaze: g(5, 15, 0), split: 18, eyes: pair(0.35, 0.12, 25) },
  angry: { id: "angry", gaze: g(3, 7, 0), split: 17, eyes: pair(0.34, 0.15, 30) },
  sad: { id: "sad", gaze: g(3, -13, 0), split: 16, eyes: pair(0.22, 0.4, -28) },
  suspicious: { id: "suspicious", gaze: g(20, 10, -10), split: 15, eyes: [eye(0.15, 0.4, -5), eye(0.3, 0.1, 20)] },
  curious: { id: "curious", gaze: g(16, -9, -15), split: 16.5, eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)] },
  proud: { id: "proud", gaze: g(5, 17, 0), split: 17, eyes: pair(0.3, 0.15, 18) },
  shy: { id: "shy", gaze: g(-19, -14, -7), split: 14, eyes: pair(0.17, 0.3) },
  unimpressed: { id: "unimpressed", gaze: g(-22, 2, 0), split: 16, eyes: pair(0.3, 0.12) },
};

export const lerpEyeCfg = (a: EyeCfg, b: EyeCfg, t: number): EyeCfg => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  tilt: lerp(a.tilt, b.tilt, t),
  open: lerp(a.open, b.open, t),
});

export function blendExpression(a: BotExpression, b: BotExpression, t: number): BotExpression {
  return {
    id: b.id,
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t),
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEyeCfg(a.eyes[0], b.eyes[0], t), lerpEyeCfg(a.eyes[1], b.eyes[1], t)],
  };
}
