import type { ArcSpec, DotRender } from "./decor";
import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from "./face";
import { createCircle, type Silhouette } from "./shape";

export interface EyeCfg {
  w: number;
  h: number;
  open: number;
  tilt: number;
}

export interface NotifRender {
  x: number;
  y: number;
  r: number;
  notch: number;
}

export interface Pose {
  sil: Silhouette;
  offX: number;
  offY: number;
  gaze: HeadGaze;
  split: number;
  eyes: EyeCfg[];
  eyeAlpha: number;
  bodyAlpha: number;
  dots: DotRender[];
  arcs: ArcSpec[];
  notif?: NotifRender;
  dotsBehind: boolean;
}

export const eyePair = (w: number, h: number): EyeCfg[] => [
  { w, h, open: 1, tilt: 0 },
  { w, h, open: 1, tilt: 0 },
];

export function basePose(p: Partial<Pose> = {}): Pose {
  return {
    sil: createCircle(1),
    offX: 0,
    offY: 0,
    gaze: REST_GAZE,
    split: EYE_SPLIT,
    eyes: eyePair(EYE_W, EYE_H),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    dotsBehind: false,
    ...p,
  };
}
