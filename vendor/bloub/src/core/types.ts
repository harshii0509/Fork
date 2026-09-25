export const BLOUB_SHAPES = [
  "circle", "pebble", "squircle", "capsule", "triangle", "cloud",
  "droplet", "flame", "medal", "acorn", "jellyfish", "clover",
] as const;
export type BloubShape = (typeof BLOUB_SHAPES)[number];

export const BLOUB_EXPRESSIONS = [
  "neutral", "attentif", "surprised", "excited", "happy", "angry",
  "sad", "suspicious", "curious", "proud", "shy", "unimpressed",
] as const;
export type BloubExpression = (typeof BLOUB_EXPRESSIONS)[number];

export const BLOUB_STATES = [
  "idle", "thinking", "wink", "wide", "alert", "notify",
  "exclaim", "sleep", "play", "orbit", "swirl", "burst",
] as const;
export type BloubState = (typeof BLOUB_STATES)[number];

export const PREDEFINED_COLORS = {
  black: "#000000",
  brown: "#765339",
  red: "#F3483F",
  orange: "#F89822",
  yellow: "#FFCC2E",
  green: "#3DD685",
  teal: "#13CDAC",
  blue: "#2C90FF",
  purple: "#7E4CFF",
  magenta: "#F4407B",
  grey: "#A1AAB4",
} as const;
export type BloubPredefinedColor = keyof typeof PREDEFINED_COLORS;
