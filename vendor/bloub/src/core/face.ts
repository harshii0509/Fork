import { TAU, clamp, createRng, loopNoise } from "./math";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const EYE_SPLIT = 15.46;
export const EYE_W = 0.186;
export const EYE_H = 0.412;

export interface HeadGaze {
  yaw: number;
  pitch: number;
  roll: number;
}

export const REST_GAZE: HeadGaze = { yaw: 28.49, pitch: 28.62, roll: -13 };

export interface EyePose {
  x: number;
  y: number;
  a: number;
  b: number;
  c: number;
  d: number;
  depth: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

function spin(u: Vec3, v: Vec3, angle: number): [Vec3, Vec3] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    { x: u.x * c + v.x * s, y: u.y * c + v.y * s, z: u.z * c + v.z * s },
    { x: v.x * c - u.x * s, y: v.y * c - u.y * s, z: v.z * c - u.z * s },
  ];
}

export function eyePoses(gaze: HeadGaze, scale: number, split = EYE_SPLIT): [EyePose, EyePose] {
  let f: Vec3 = { x: 0, y: 0, z: 1 };
  let right: Vec3 = { x: 1, y: 0, z: 0 };
  let down: Vec3 = { x: 0, y: 1, z: 0 };

  [f, right] = spin(f, right, deg(gaze.yaw));
  [down, f] = spin(down, f, deg(gaze.pitch));
  [right, down] = spin(right, down, deg(gaze.roll));

  const build = (side: number): EyePose => {
    const [ef, er] = spin(f, right, deg(split * side));
    return { x: ef.x * scale, y: ef.y * scale, a: er.x, b: er.y, c: down.x, d: down.y, depth: ef.z };
  };
  return [build(-1), build(1)];
}

export interface Liveliness {
  dYaw: number;
  dPitch: number;
  dRoll: number;
  lid: number;
  driftX: number;
  driftY: number;
  breath: number;
}

const blinkRng = createRng(0x5eed);
const blinks: number[] = (() => {
  const out: number[] = [];
  let t = 1.4;
  while (t < 900) {
    out.push(t);
    t += 1.9 + blinkRng() * 2.7;
    if (blinkRng() < 0.18) {
      out.push(t);
      t += 0.24;
    }
  }
  return out;
})();

const BLINK_DUR = 0.18;

export function blinkLid(t: number): number {
  for (let i = 0; i < blinks.length; i++) {
    const start = blinks[i];
    if (t < start) break;
    const k = (t - start) / BLINK_DUR;
    if (k >= 0 && k <= 1) return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55;
  }
  return 1;
}

export function getLiveliness(
  t: number,
  { wander = 1, blink = true, float = true } = {},
): Liveliness {
  return {
    dYaw: (loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6) * wander,
    dPitch: (loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3) * wander,
    dRoll: loopNoise(t, 13.7, 3.2) * 2.2 * wander,
    lid: blink ? blinkLid(t) : 1,
    driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
    driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
    breath: float ? 1 + Math.sin((t / 3.4) * TAU) * 0.005 : 1,
  };
}

export const getBlinkScale = (lid: number): number => 0.06 + 0.94 * clamp(lid);
