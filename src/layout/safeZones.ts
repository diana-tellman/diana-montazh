import zones from "../../config/safe-zones.json";
import type { FormatId } from "../formats";

export type Rect = { x0: number; x1: number; y0: number; y1: number };
export type Platform = "reels" | "stories" | "shorts" | "tiktok" | "feed" | "square" | "youtube";
export type SafeZone = Rect & { format: FormatId; label: string };

export function safeZone(p: Platform): SafeZone {
  const z = (zones as unknown as Record<string, SafeZone>)[p];
  if (!z) throw new Error(`Нет пресета безопасной зоны: ${p}`);
  return z;
}

export function defaultPlatform(f: FormatId): Platform {
  return f === "9:16" ? "reels" : f === "4:5" ? "feed" : f === "1:1" ? "square" : "youtube";
}

export const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
export function intersect(a: Rect, b: Rect): Rect {
  return { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
}
export const overlaps = (a: Rect, b: Rect, tol = 0) => area(intersect(a, b)) > tol;
export const inside = (inner: Rect, outer: Rect, eps = 1e-6) =>
  inner.x0 >= outer.x0 - eps && inner.x1 <= outer.x1 + eps && inner.y0 >= outer.y0 - eps && inner.y1 <= outer.y1 + eps;

/** Horizontal band for centred text: centred on the frame, as wide as the safe zone allows on BOTH sides. */
export function captionBand(z: Rect): { x0: number; x1: number } {
  const half = Math.min(0.5 - z.x0, z.x1 - 0.5);
  return { x0: 0.5 - half, x1: 0.5 + half };
}
