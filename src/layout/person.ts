import { computeWindow, type CameraState, type Framing, type Window } from "./frame";
import { layoutStateAt, type Layout } from "../storyboard/schema";

export type LayoutKind = "full" | "circle" | "split" | "pip" | "compare" | "explainer";
export type Box = { x: number; y: number; w: number; h: number };

/** pip window (9:16 → 670×586 px at the top, inside the Reels safe zone). */
const PIP = { x0: 0.19, x1: 0.81, y0: 0.125, y1: 0.43 };

/** Where the person goes for each layout (output px). Shared by planner, validator and composition. */
export function personBox(kind: LayoutKind, W: number, H: number, shape: "rounded" | "circle" = "rounded"): Box {
  if (kind === "circle") {
    const d = 2 * Math.round(Math.min(W, H) * 0.32); // even → exactly centred
    return { x: Math.round((W - d) / 2), y: Math.round(H * 0.44 - d / 2), w: d, h: d };
  }
  if (kind === "pip") {
    const w = Math.round((PIP.x1 - PIP.x0) * W);
    const h = Math.round((PIP.y1 - PIP.y0) * H);
    if (shape === "circle") {
      const d = 2 * Math.round(Math.min(w, h) / 2);
      return { x: Math.round((W - d) / 2), y: Math.round(PIP.y0 * H), w: d, h: d };
    }
    return { x: Math.round(PIP.x0 * W), y: Math.round(PIP.y0 * H), w, h };
  }
  if (kind === "split" || kind === "compare") return { x: 0, y: Math.round(H / 2), w: W, h: H - Math.round(H / 2) };
  if (kind === "explainer") return { x: Math.round(W / 2), y: Math.round(H / 2), w: 0, h: 0 };
  return { x: 0, y: 0, w: W, h: H };
}

/** Secondary visual area (split/compare top half; full frame behind circle / pip / explainer). */
export function secondaryBox(kind: LayoutKind, W: number, H: number): Box {
  return kind === "split" || kind === "compare" ? { x: 0, y: 0, w: W, h: Math.round(H / 2) } : { x: 0, y: 0, w: W, h: H };
}

/** Area of the graphic card of a layout (normalised). Captions, icons and the face never go there. */
export function cardRect(kind: LayoutKind): { x0: number; x1: number; y0: number; y1: number } | null {
  if (kind === "pip") return { x0: 0.08, x1: 0.92, y0: 0.45, y1: 0.63 };
  if (kind === "compare") return { x0: 0.04, x1: 0.96, y0: 0.12, y1: 0.4 };
  if (kind === "explainer") return { x0: 0.06, x1: 0.94, y0: 0.13, y1: 0.63 };
  return null;
}

/** Window of the person's video in OUTPUT pixels for a (settled) layout. */
export function personWindow(kind: LayoutKind, srcW: number, srcH: number, W: number, H: number, framing: Framing, cam: CameraState, shape: "rounded" | "circle" = "rounded"): Window {
  if (kind === "full" || kind === "explainer") return computeWindow(srcW, srcH, W, H, framing, cam, { x: 0.5, y: 0.36 });
  const b = personBox(kind, W, H, shape);
  const win = computeWindow(srcW, srcH, b.w, b.h, "cover", { ...cam, zoom: Math.max(1, cam.zoom * 0.95) }, { x: 0.5, y: kind === "circle" || kind === "pip" ? 0.42 : 0.4 });
  return { scale: win.scale, offX: win.offX + b.x, offY: win.offY + b.y };
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/**
 * Person box / window / corner radius at time t INCLUDING the animated move between full frame and a layout
 * (the speaker slides into the window and back). The single source of truth for planner, checks and render.
 * `settled` = position after the move (used for face protection: captions appear with the layout).
 */
export function personAt(layouts: Layout[], t: number, srcW: number, srcH: number, W: number, H: number, framing: Framing, cam: CameraState, settled = false) {
  const st0 = layoutStateAt(layouts, t);
  // settled: protection zones use the layout's final position (the 0.3 s move itself is not a reading moment).
  const st = settled && st0.kind !== "full" ? { ...st0, p: 1 } : st0;
  const shape = st.layout?.shape ?? "rounded";
  const full = personWindow("full", srcW, srcH, W, H, framing, cam);
  if (st.kind === "full" || st.kind === "explainer") {
    // Explainer: the person stays full-frame underneath and is covered by the explainer graphic.
    return { kind: st.kind, p: st.p, window: full, box: personBox("full", W, H), radius: 0, visible: st.kind === "full" || st.p < 1, shape };
  }
  const to = personWindow(st.kind, srcW, srcH, W, H, framing, cam, shape);
  const bt = personBox(st.kind, W, H, shape);
  const p = st.p;
  const box = { x: lerp(0, bt.x, p), y: lerp(0, bt.y, p), w: lerp(W, bt.w, p), h: lerp(H, bt.h, p) };
  const radiusTo = st.kind === "circle" || (st.kind === "pip" && shape === "circle") ? bt.w / 2 : st.kind === "pip" ? Math.round(W * 0.045) : 0;
  return {
    kind: st.kind, p, shape, visible: true, box, radius: lerp(0, radiusTo, p),
    window: { scale: lerp(full.scale, to.scale, p), offX: lerp(full.offX, to.offX, p), offY: lerp(full.offY, to.offY, p) },
  };
}

/** Clip a normalised rect to the visible person area (hidden parts cannot be covered). */
export function clipToBox(r: { x0: number; x1: number; y0: number; y1: number }, b: Box, W: number, H: number) {
  return { x0: Math.max(r.x0, b.x / W), x1: Math.min(r.x1, (b.x + b.w) / W), y0: Math.max(r.y0, b.y / H), y1: Math.min(r.y1, (b.y + b.h) / H) };
}

/** Clip a normalised rect to the visible person area of a settled layout. */
export function clipToPerson(r: { x0: number; x1: number; y0: number; y1: number }, kind: LayoutKind, W: number, H: number) {
  return clipToBox(r, personBox(kind, W, H), W, H);
}
