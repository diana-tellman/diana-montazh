/**
 * Source → output framing. ONE function used by the planner (layout checks) and by the
 * Remotion composition (CSS transform), so what the storyboard checks is what renders.
 *
 * output_px = source_px * scale + (offX, offY)
 */
export type Framing = "cover" | "contain";
export type Window = { scale: number; offX: number; offY: number };

export type CameraState = {
  /** 1 = base framing; >1 zooms in. */
  zoom: number;
  /** Anchor in source (normalised), usually the face/eyes. */
  ax: number;
  ay: number;
};

/** Choose cover (fill, crop) unless the source aspect differs too much from the output. */
export function chooseFraming(srcW: number, srcH: number, outW: number, outH: number): Framing {
  const rs = srcW / srcH;
  const ro = outW / outH;
  // 4:5 or 3:4 into 9:16 → crop (natural); 16:9 into 9:16 → contain over a blurred fill.
  return Math.max(rs / ro, ro / rs) > 1.5 ? "contain" : "cover";
}

/**
 * Compute the window. In cover mode the anchor is placed at (targetX, targetY) of the output
 * and clamped so no frame edge is ever visible. In contain mode the video fits the width
 * (or height) and sits at `containY`; zoom pushes in around the anchor.
 */
export function computeWindow(
  srcW: number, srcH: number, outW: number, outH: number, framing: Framing, cam: CameraState,
  target = { x: 0.5, y: 0.4 }, containY = 0.42,
): Window {
  if (framing === "cover") {
    const scale = Math.max(outW / srcW, outH / srcH) * Math.max(1, cam.zoom);
    const w = srcW * scale;
    const h = srcH * scale;
    let offX = target.x * outW - cam.ax * w;
    let offY = target.y * outH - cam.ay * h;
    offX = Math.min(0, Math.max(outW - w, offX));
    offY = Math.min(0, Math.max(outH - h, offY));
    return { scale, offX, offY };
  }
  const base = Math.min(outW / srcW, outH / srcH);
  const scale = base * Math.max(1, cam.zoom);
  const w = srcW * scale;
  const h = srcH * scale;
  // Centre of the fitted video, then push toward the anchor as zoom grows.
  const cx0 = outW / 2 - (w / 2);
  const cy0 = containY * outH - h / 2;
  const k = (Math.max(1, cam.zoom) - 1) / Math.max(1e-6, Math.max(1, cam.zoom));
  const offX = cx0 + (0.5 - cam.ax) * w * k;
  const offY = cy0 + (0.5 - cam.ay) * h * k;
  return { scale, offX, offY };
}

/** Map a normalised source rect to normalised output coordinates. */
export function mapRect(r: { x0: number; x1: number; y0: number; y1: number }, srcW: number, srcH: number, outW: number, outH: number, win: Window) {
  return {
    x0: (r.x0 * srcW * win.scale + win.offX) / outW,
    x1: (r.x1 * srcW * win.scale + win.offX) / outW,
    y0: (r.y0 * srcH * win.scale + win.offY) / outH,
    y1: (r.y1 * srcH * win.scale + win.offY) / outH,
  };
}

/** Smooth ease used for camera moves (cubic in-out). */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
