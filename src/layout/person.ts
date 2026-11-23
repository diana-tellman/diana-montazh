import { computeWindow, type CameraState, type Framing, type Window } from "./frame";

export type LayoutKind = "full" | "circle" | "split";
export type Box = { x: number; y: number; w: number; h: number };

/** Where the person goes for each layout (output px). Shared by planner, validator and composition. */
export function personBox(kind: LayoutKind, W: number, H: number): Box {
  if (kind === "circle") {
    const d = 2 * Math.round(Math.min(W, H) * 0.32); // even → exactly centred
    return { x: Math.round((W - d) / 2), y: Math.round(H * 0.44 - d / 2), w: d, h: d };
  }
  if (kind === "split") return { x: 0, y: Math.round(H / 2), w: W, h: H - Math.round(H / 2) };
  return { x: 0, y: 0, w: W, h: H };
}

/** Secondary visual area (split top half / circle background). */
export function secondaryBox(kind: LayoutKind, W: number, H: number): Box {
  return kind === "split" ? { x: 0, y: 0, w: W, h: Math.round(H / 2) } : { x: 0, y: 0, w: W, h: H };
}

/** Window of the person's video in OUTPUT pixels for a layout. */
export function personWindow(kind: LayoutKind, srcW: number, srcH: number, W: number, H: number, framing: Framing, cam: CameraState): Window {
  const b = personBox(kind, W, H);
  if (kind === "full") return computeWindow(srcW, srcH, W, H, framing, cam, { x: 0.5, y: 0.36 });
  const win = computeWindow(srcW, srcH, b.w, b.h, "cover", { ...cam, zoom: Math.max(1, cam.zoom * 0.95) }, { x: 0.5, y: kind === "circle" ? 0.42 : 0.4 });
  return { scale: win.scale, offX: win.offX + b.x, offY: win.offY + b.y };
}

/** Clip a normalised rect to the visible person area of a layout (hidden parts cannot be covered). */
export function clipToPerson(r: { x0: number; x1: number; y0: number; y1: number }, kind: LayoutKind, W: number, H: number) {
  const b = personBox(kind, W, H);
  return { x0: Math.max(r.x0, b.x / W), x1: Math.min(r.x1, (b.x + b.w) / W), y0: Math.max(r.y0, b.y / H), y1: Math.min(r.y1, (b.y + b.h) / H) };
}
