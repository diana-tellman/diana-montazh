import type { Faces } from "../analysis/faces";
import { computeWindow, easeInOut, mapRect } from "../layout/frame";
import { captionBand, overlaps, safeZone, type Rect } from "../layout/safeZones";
import { STYLES } from "../design/styles";
import { cameraAt, type Check, type Storyboard } from "../storyboard/schema";
import { estTextWidth } from "./planner";

const FACE_TARGET = { x: 0.5, y: 0.36 };

/** Face/head boxes in output coordinates at time t (for checks and storyboard guides). */
export function faceBoxesAt(sb: Storyboard, faces: Faces | null, t: number, pad = 0): Rect[] {
  if (!faces) return [];
  const v = sb.visuals.find((x) => t >= x.start && t < x.end) ?? sb.visuals[0];
  if (!v || v.kind !== "video") return [];
  const s = faces.samples.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), faces.samples[0]!);
  if (!s?.face || Math.abs(s.t - t) > 0.5) return [];
  const win = computeWindow(v.srcW, v.srcH, sb.width, sb.height, v.framing, cameraAt(sb.camera, t, easeInOut), FACE_TARGET);
  const fw = s.face.x1 - s.face.x0;
  // Protected zone = face oval widened for hair/ears, from the real head top to the chin.
  const r = mapRect({ x0: s.face.x0 - fw * 0.18, x1: s.face.x1 + fw * 0.18, y0: s.face.headTop, y1: s.face.chinY }, v.srcW, v.srcH, sb.width, sb.height, win);
  return [{ x0: r.x0 - pad, x1: r.x1 + pad, y0: r.y0 - pad, y1: r.y1 + pad }];
}

/**
 * Re-check any storyboard (also after manual edits): captions inside the safe zone and
 * never over the face at any sampled moment, readable size, timing inside the video.
 */
export function validateStoryboard(sb: Storyboard, faces: Faces | null, baseChecks: Check[] = []): Check[] {
  const st = STYLES[sb.style.preset];
  const safe = safeZone(sb.platform);
  const checks: Check[] = baseChecks.filter((c) => !["caption_face", "caption_safe", "caption_small", "timing", "behind_safe"].includes(c.code));
  const px0 = st.size * Math.min(sb.width, sb.height);
  for (const c of sb.captions) {
    const text = c.lines.map((l) => l.map((w) => w.text).join(" "));
    const px = px0 * c.scale;
    const wMax = Math.max(...text.map((t) => estTextWidth(t, px, st)));
    const h = (c.lines.length * px * st.lineHeight + px * 0.5) / sb.height;
    const box = { x0: 0.5 - wMax / 2 / sb.width, x1: 0.5 + wMax / 2 / sb.width, y0: c.y, y1: c.y + h };
    const label = `«${text.join(" ")}»`;
    const band = captionBand(safe);
    if (box.x0 < band.x0 - 0.01 || box.x1 > band.x1 + 0.01 || box.y0 < safe.y0 - 0.002 || box.y1 > safe.y1 + 0.002)
      checks.push({ level: "error", code: "caption_safe", at: c.start, message: `Субтитр ${label} выходит из безопасной зоны.` });
    if (c.scale < 0.72) checks.push({ level: "warn", code: "caption_small", at: c.start, message: `Субтитр ${label} мельче минимума читаемости.` });
    for (let t = c.start; t <= c.end; t += 0.2) {
      const fb = faceBoxesAt(sb, faces, t);
      if (fb.some((f) => overlaps(box, f, 0.0005))) {
        checks.push({ level: "error", code: "caption_face", at: c.start, message: `Субтитр ${label} перекрывает лицо около ${t.toFixed(1)} с.` });
        break;
      }
    }
    if (c.end > sb.durationSec + 0.05 || c.start >= c.end) checks.push({ level: "error", code: "timing", at: c.start, message: `Неверное время субтитра ${label}.` });
  }
  for (const b of sb.behindText) {
    const hh = (b.size * sb.width) / sb.height;
    if (b.y - hh * 0.55 < safe.y0 - 0.01) checks.push({ level: "warn", code: "behind_safe", at: b.start, message: `Слово за головой «${b.text}» заходит в верхнюю зону интерфейса.` });
  }
  return checks;
}
