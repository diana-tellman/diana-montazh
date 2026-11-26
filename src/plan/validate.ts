import type { Faces } from "../analysis/faces";
import { easeInOut, mapRect } from "../layout/frame";
import { captionBand, insideSafe, overlaps, safeZone, type Rect } from "../layout/safeZones";
import { resolveStyle } from "../design/styles";
import { cameraAt, layoutAt, type Check, type Storyboard } from "../storyboard/schema";
import { cardRect, clipToBox, personAt } from "../layout/person";
import { estTextWidth } from "./planner";


/** Face/head boxes in output coordinates at time t (for checks and storyboard guides). */
export function faceBoxesAt(sb: Storyboard, faces: Faces | null, t: number, pad = 0): Rect[] {
  if (!faces) return [];
  const v = sb.visuals.find((x) => t >= x.start && t < x.end) ?? sb.visuals[0];
  if (!v || v.kind !== "video") return [];
  const s = faces.samples.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), faces.samples[0]!);
  if (!s?.face || Math.abs(s.t - t) > 0.5) return [];
  const pa = personAt(sb.layouts, t, v.srcW, v.srcH, sb.width, sb.height, v.framing, cameraAt(sb.camera, t, easeInOut), true);
  if (!pa.visible) return [];
  const fw = s.face.x1 - s.face.x0;
  // Protected zone = face oval widened for hair/ears, from the real head top to the chin.
  const r = clipToBox(mapRect({ x0: s.face.x0 - fw * 0.18, x1: s.face.x1 + fw * 0.18, y0: s.face.headTop, y1: s.face.chinY }, v.srcW, v.srcH, sb.width, sb.height, pa.window), pa.box, sb.width, sb.height);
  if (r.y1 <= r.y0 || r.x1 <= r.x0) return [];
  return [{ x0: r.x0 - pad, x1: r.x1 + pad, y0: r.y0 - pad, y1: r.y1 + pad }];
}

/**
 * Re-check any storyboard (also after manual edits): captions inside the safe zone and
 * never over the face at any sampled moment, readable size, timing inside the video.
 */
export function validateStoryboard(sb: Storyboard, faces: Faces | null, baseChecks: Check[] = []): Check[] {
  const st = resolveStyle(sb.style.preset, sb.style.overrides);
  const safe = safeZone(sb.platform);
  const checks: Check[] = baseChecks.filter((c) => !["caption_face", "caption_safe", "caption_small", "timing", "behind_safe", "card_overlap", "plate_face", "audio_balance"].includes(c.code));
  const px0 = st.size * Math.min(sb.width, sb.height);
  for (const c of sb.captions) {
    const text = c.lines.map((l) => l.map((w) => w.text).join(" "));
    const px = px0 * c.scale;
    const wMax = Math.max(...text.map((t) => estTextWidth(t, px, st)));
    const h = (c.lines.length * px * st.lineHeight + px * 0.5) / sb.height;
    const box = { x0: 0.5 - wMax / 2 / sb.width, x1: 0.5 + wMax / 2 / sb.width, y0: c.y, y1: c.y + h };
    const label = `«${text.join(" ")}»`;
    const band = captionBand(safe, box.y1);
    if (box.x0 < band.x0 - 0.01 || box.x1 > band.x1 + 0.01 || box.y0 < safe.y0 - 0.002 || box.y1 > safe.y1 + 0.002)
      checks.push({ level: "error", code: "caption_safe", at: c.start, message: `Субтитр ${label} выходит из безопасной зоны.` });
    for (const l of sb.layouts.filter((x) => x.card && x.start < c.end && x.end > c.start)) {
      const cr = cardRect(l.kind);
      if (cr && overlaps(box, cr, 0.0005)) checks.push({ level: "error", code: "card_overlap", at: c.start, message: `Субтитр ${label} накладывается на карточку (${l.kind}).` });
    }
    if (c.scale < 0.72) checks.push({ level: "warn", code: "caption_small", at: c.start, message: `Субтитр ${label} мельче минимума читаемости.` });
    for (let t = c.start; t < c.end - 0.001; t += 0.2) {
      const fb = faceBoxesAt(sb, faces, t);
      if (fb.some((f) => overlaps(box, f, 0.0005))) {
        checks.push({ level: "error", code: "caption_face", at: c.start, message: `Субтитр ${label} перекрывает лицо около ${t.toFixed(1)} с.` });
        break;
      }
    }
    if (c.end > sb.durationSec + 0.05 || c.start >= c.end) checks.push({ level: "error", code: "timing", at: c.start, message: `Неверное время субтитра ${label}.` });
  }
  for (const ic of sb.icons) {
    const r = ic.size / 2;
    const box = { x0: ic.x - r, x1: ic.x + r, y0: ic.y - (r * sb.width) / sb.height, y1: ic.y + (r * sb.width) / sb.height };
    for (let t = ic.start; t < ic.end - 0.001; t += 0.3) {
      if (faceBoxesAt(sb, faces, t).some((f) => overlaps(box, f, 0.0005))) {
        checks.push({ level: "error", code: "caption_face", at: ic.start, message: `Иконка «${ic.name}» перекрывает лицо.` });
        break;
      }
    }
  }
  for (const k of sb.callouts) {
    const px = 0.042 * sb.width;
    const wN = (k.text.length * px * 0.6 + px * 1.8) / sb.width;
    const box = { x0: 0.5 - wN / 2, x1: 0.5 + wN / 2, y0: k.y, y1: k.y + 0.05 };
    if (!insideSafe(box, safe, 0.01)) checks.push({ level: "warn", code: "plate_face", at: k.start, message: `Плашка «${k.text}» выходит из безопасной зоны.` });
    for (let t = k.start; t < k.end - 0.001; t += 0.3) {
      if (faceBoxesAt(sb, faces, t).some((f) => overlaps(box, f, 0.0005))) {
        checks.push({ level: "error", code: "plate_face", at: k.start, message: `Плашка «${k.text}» перекрывает лицо.` });
        break;
      }
    }
  }
  // Voice must stay on top: effects and music are kept far below speech.
  const loudSfx = sb.sfx.filter((x) => x.gain > 0.35);
  if (loudSfx.length) checks.push({ level: "warn", code: "audio_balance", at: loudSfx[0]!.t, message: `Звуковой эффект громче нормы (${loudSfx.length} шт.) — может заглушить голос.` });
  if (sb.music && (sb.music.duck > 0.12 || sb.music.gain > 0.35)) checks.push({ level: "warn", code: "audio_balance", at: null, message: "Музыка слишком громкая относительно голоса." });
  for (const b of sb.behindText) {
    const hh = (b.size * sb.width) / sb.height;
    if (b.y - hh * 0.55 < safe.y0 - 0.01) checks.push({ level: "warn", code: "behind_safe", at: b.start, message: `Слово за головой «${b.text}» заходит в верхнюю зону интерфейса.` });
  }
  return checks;
}
