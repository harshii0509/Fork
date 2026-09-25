import { PROFILE_SAMPLES } from "./profiles";
import { TAU } from "./math";
import {
  hullOfCircles, profileFromPolygon, regularPolygonProfile, smoothProfile,
  superellipseProfile, unionOfCirclesProfile,
} from "./shape";
import type { BloubShape } from "./types";

function normalize(radii: number[], maxVal = 1): number[] {
  const peak = Math.max(0, ...radii);
  if (peak <= 0) return radii;
  const k = maxVal / peak;
  return radii.map((r) => r * k);
}

const c = (x: number, y: number, r: number) => ({ x, y, r });

export const shapeProfiles: Record<BloubShape, number[]> = {
  circle: new Array<number>(PROFILE_SAMPLES).fill(1),
  pebble: normalize(
    Array.from({ length: PROFILE_SAMPLES }, (_, i) => {
      const a = (i / PROFILE_SAMPLES) * TAU;
      return 1 + 0.075 * Math.cos(2 * a + 0.5) + 0.035 * Math.cos(3 * a + 2.1);
    }),
    1.02,
  ),
  squircle: normalize(superellipseProfile(4.2), 1.15),
  capsule: profileFromPolygon(hullOfCircles(-0.42, 0, 0.62, 0.42, 0, 0.62), 0, 0),
  triangle: regularPolygonProfile(3, 1.12, 0.34, -90),
  cloud: normalize(
    unionOfCirclesProfile([
      c(-0.44, 0.2, 0.54), c(0.46, 0.2, 0.5), c(0.02, 0.3, 0.6), c(-0.24, -0.3, 0.48), c(0.3, -0.24, 0.44),
    ]),
    1.02,
  ),
  droplet: normalize(profileFromPolygon(hullOfCircles(0, 0.28, 0.66, 0, -0.96, 0.05), 0, 0), 1.04),
  flame: normalize(
    smoothProfile(
      unionOfCirclesProfile([c(0, 0.3, 0.5), c(-0.2, 0.1, 0.4), c(0, -0.2, 0.35), c(0.15, -0.5, 0.15)]),
      16,
    ),
    1.05,
  ),
  medal: normalize(
    unionOfCirclesProfile([
      c(0, -0.2, 0.5), c(-0.25, 0.5, 0.2), c(0.25, 0.5, 0.2), c(-0.35, 0.3, 0.15), c(0.35, 0.3, 0.15),
    ]),
    1.05,
  ),
  acorn: normalize(unionOfCirclesProfile([c(0, 0.2, 0.5), c(0, -0.2, 0.6), c(0, -0.6, 0.15)]), 1.05),
  jellyfish: normalize(
    unionOfCirclesProfile([
      c(0, -0.2, 0.6), c(-0.4, 0.4, 0.2), c(-0.15, 0.45, 0.2), c(0.15, 0.45, 0.2), c(0.4, 0.4, 0.2),
    ]),
    1.05,
  ),
  clover: normalize(
    unionOfCirclesProfile([c(-0.4, -0.4, 0.5), c(0.4, -0.4, 0.5), c(-0.4, 0.4, 0.5), c(0.4, 0.4, 0.5)]),
    1.1,
  ),
};
