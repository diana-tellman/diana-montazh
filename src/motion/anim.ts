import { Easing, interpolate } from "remotion";

/**
 * Motion library: one easing family for the whole system (no bounce), consistent durations.
 * in 0.28–0.55 s, out 0.18–0.25 s. Every function is pure (time → style), deterministic per frame.
 */
export const EASE_IN = Easing.bezier(0.16, 1, 0.3, 1); // expo-out: fast start, long soft landing
export const EASE_OUT = Easing.bezier(0.5, 0, 0.75, 0); // quad-in: calm start, clean exit
export const EASE_MOVE = Easing.bezier(0.65, 0, 0.35, 1); // in-out for editorial slides
const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type Anim = "mask" | "stagger" | "word" | "script" | "fade" | "blur" | "scale" | "tracking" | "slideLeft" | "slideRight" | "typewriter";
export type Exit = "up" | "down" | "fade" | "blur" | "left" | "right" | "none";

export const IN_DUR: Record<Anim, number> = {
  mask: 0.42, stagger: 0.42, word: 0.38, script: 0.6, fade: 0.36, blur: 0.5, scale: 0.45, tracking: 0.7, slideLeft: 0.45, slideRight: 0.45, typewriter: 0.04,
};
export const OUT_DUR = 0.22;

export function progress(t: number, at: number, dur: number, ease = EASE_IN): number {
  return interpolate(t, [at, at + dur], [0, 1], { ...C, easing: ease });
}

/** Velocity-based soft motion blur (px) for an eased 0..1 progress: strongest at the start of the move. */
export function motionBlur(p: number, maxPx: number): number {
  return p <= 0 || p >= 1 ? 0 : Math.max(0, (1 - p) ** 2 * maxPx);
}

/** Style of a whole text block entering (except per-unit anims handled by the caller). */
export function enterStyle(anim: Anim, p: number, fontPx: number): { outer: React.CSSProperties; inner: React.CSSProperties; masked: boolean } {
  const mb = motionBlur(p, fontPx * 0.05);
  switch (anim) {
    case "mask":
      return { masked: true, outer: {}, inner: { transform: `translateY(${(1 - p) * 108}%)`, filter: mb ? `blur(${mb}px)` : undefined } };
    case "scale":
      return { masked: true, outer: {}, inner: { transform: `translateY(${(1 - p) * 70}%) scale(${0.9 + 0.1 * p})`, opacity: Math.min(1, p * 1.6) } };
    case "script":
      return { masked: false, outer: {}, inner: { clipPath: `inset(-25% ${(1 - p) * 102}% -25% -8%)`, transform: `translateX(${(1 - p) * -2.5}%)`, opacity: Math.min(1, p * 2.5) } };
    case "fade":
      return { masked: false, outer: {}, inner: { opacity: p, transform: `translateY(${(1 - p) * fontPx * 0.18}px)` } };
    case "blur":
      return { masked: false, outer: {}, inner: { opacity: p, filter: `blur(${(1 - p) * fontPx * 0.16}px)`, transform: `scale(${1.06 - 0.06 * p})` } };
    case "tracking":
      return { masked: false, outer: {}, inner: { opacity: p, letterSpacing: `${(1 - p) * 0.5}em`, filter: `blur(${(1 - p) * fontPx * 0.06}px)` } };
    case "slideLeft":
      return { masked: true, outer: {}, inner: { transform: `translateX(${(1 - p) * 104}%)`, filter: mb ? `blur(${mb}px)` : undefined } };
    case "slideRight":
      return { masked: true, outer: {}, inner: { transform: `translateX(${-(1 - p) * 104}%)`, filter: mb ? `blur(${mb}px)` : undefined } };
    default:
      return { masked: false, outer: {}, inner: {} };
  }
}

/** Exit style; e = 0..1. */
export function exitStyle(exit: Exit, e: number, fontPx: number): React.CSSProperties {
  if (e <= 0 || exit === "none") return {};
  switch (exit) {
    case "up": return { transform: `translateY(${-e * fontPx * 0.5}px)`, opacity: 1 - e, filter: `blur(${e * fontPx * 0.05}px)` };
    case "down": return { transform: `translateY(${e * fontPx * 0.5}px)`, opacity: 1 - e };
    case "blur": return { opacity: 1 - e, filter: `blur(${e * fontPx * 0.18}px)`, transform: `scale(${1 + 0.05 * e})` };
    case "left": return { transform: `translateX(${-e * fontPx * 1.2}px)`, opacity: 1 - e };
    case "right": return { transform: `translateX(${e * fontPx * 1.2}px)`, opacity: 1 - e };
    default: return { opacity: 1 - e };
  }
}

/** Per-unit (letter / word) reveal for stagger, word and typewriter anims. */
export function unitStyle(anim: Anim, t: number, start: number, fontPx: number): React.CSSProperties {
  if (anim === "typewriter") return { opacity: t >= start ? 1 : 0 };
  const p = progress(t, start, anim === "word" ? 0.36 : 0.34);
  const mb = motionBlur(p, fontPx * 0.06);
  return { display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, opacity: anim === "word" ? Math.min(1, p * 1.8) : 1, filter: mb ? `blur(${mb}px)` : undefined };
}
