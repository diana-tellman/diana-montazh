import type { Faces } from "../analysis/faces";
import { faceAnchor } from "../analysis/faces";
import type { Project } from "../core/project";
import { STYLES, contrastRatio, type Colors, type StyleDef, type StylePreset } from "../design/styles";
import { FORMATS, type FormatId } from "../formats";
import { chooseFraming, computeWindow, easeInOut, mapRect, type Framing } from "../layout/frame";
import { inside, overlaps, safeZone, type Platform, type Rect } from "../layout/safeZones";
import type { Transcript } from "../speech/transcript";
import type { BehindText, CameraKey, Caption, Check, Scene, Sfx, Storyboard, Visual } from "../storyboard/schema";
import { cameraAt } from "../storyboard/schema";
import { groupPhrases, parseEmphasis, splitLines, type TWord } from "./phrases";

export type PlanOptions = {
  format: FormatId;
  platform: Platform;
  style: StylePreset;
  colors?: Partial<Colors>;
  captionPosition: "auto" | "top" | "middle" | "bottom";
  behindText: boolean;
  sfx: boolean;
  progressBar: boolean;
  /** 0 = static camera, 1 = normal, 2 = energetic. */
  cameraEnergy: 0 | 1 | 2;
};

export const DEFAULT_OPTIONS: PlanOptions = {
  format: "9:16", platform: "reels", style: "brand", captionPosition: "auto", behindText: true, sfx: true, progressBar: true, cameraEnergy: 1,
};

export type PlanInput = {
  project: Project;
  transcript: Transcript;
  faces: Faces | null;
  /** Project-relative blurred fill per video asset (contain framing). */
  fills: Record<string, string>;
  options: PlanOptions;
};

const FACE_TARGET = { x: 0.5, y: 0.36 };
const MIN_SCALE = 0.72;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Approximate rendered text width in px (the composition also fits text in the browser). */
export function estTextWidth(text: string, fontPx: number, st: StyleDef): number {
  const f = st.font === "montserrat" ? 0.64 : st.font === "inter" ? 0.56 : 0.57;
  return text.length * fontPx * f * (st.uppercase ? 1.12 : 1) + text.length * st.letterSpacing * fontPx;
}

export function buildStoryboard(inp: PlanInput, version = 1): Storyboard {
  const { project, transcript, faces, options: o } = inp;
  const fmt = FORMATS[o.format];
  const W = fmt.width;
  const H = fmt.height;
  const short = Math.min(W, H);
  const safe = safeZone(o.platform);
  const st = STYLES[o.style];
  const colors: Colors = { ...st.colors, ...(o.colors ?? {}) };
  const fps = 30;
  const voice = project.assets.find((a) => a.id === project.voiceAssetId);
  if (!voice) throw new Error("Нет голосовой записи");
  const duration = Math.max(0.5, voice.info.durationSec || transcript.durationMs / 1000);
  const checks: Check[] = [];

  // ---------- words & phrases ----------
  const words: TWord[] = transcript.segments.flatMap((s) =>
    s.words.map((w) => {
      const e = parseEmphasis(w.text);
      return { text: st.uppercase ? e.text.toUpperCase() : e.text, start: w.startMs / 1000, end: w.endMs / 1000, emphasis: e.emphasis };
    }),
  );
  const phrases = groupPhrases(words, { maxWords: st.maxWordsPerPhrase, maxChars: st.maxCharsPerLine * 2 - 2, pause: 0.45, minDur: 0.6 });
  // Auto emphasis: one long content word every ~3 phrases if the user marked none.
  if (!words.some((w) => w.emphasis && !/\d/.test(w.text))) {
    phrases.forEach((p, i) => {
      if (i % 3 !== 1) return;
      const cand = [...p].filter((w) => w.text.replace(/[^\p{L}]/gu, "").length >= 6).sort((a, b) => b.text.length - a.text.length)[0];
      if (cand) cand.emphasis = true;
    });
  }

  // ---------- visuals ----------
  const visuals: Visual[] = [];
  const mainVideo = project.assets.find((a) => a.role === "main-video");
  if (project.mode === "expert-video" && mainVideo?.info.video) {
    const v = mainVideo.info.video;
    const framing: Framing = chooseFraming(v.width, v.height, W, H);
    visuals.push({
      id: "v1", start: 0, end: duration, kind: "video", src: mainVideo.prepared, srcStart: 0, srcW: v.width, srcH: v.height, framing,
      fill: framing === "contain" ? inp.fills[mainVideo.id] ?? null : null,
    });
  } else {
    const items = project.assets.filter((a) => a.role === "photo" || a.role === "broll-video");
    if (!items.length) {
      visuals.push({ id: "g1", start: 0, end: duration, kind: "graphic", src: null, srcStart: 0, srcW: W, srcH: H, framing: "cover", fill: null });
    } else {
      // Split at phrase boundaries into roughly equal slots.
      const bounds = phrases.map((p) => p[0]!.start).filter((t) => t > 0.5);
      let t = 0;
      items.forEach((a, i) => {
        const ideal = ((i + 1) * duration) / items.length;
        let end = i === items.length - 1 ? duration : bounds.reduce((b, x) => (Math.abs(x - ideal) < Math.abs(b - ideal) ? x : b), ideal);
        if (a.role === "broll-video") end = Math.min(end, t + Math.max(1, a.info.durationSec));
        if (end - t < 1.2 && i !== items.length - 1) end = t + 1.2;
        const vi = a.info.video!;
        const framing = a.role === "photo" ? "cover" : chooseFraming(vi.width, vi.height, W, H);
        visuals.push({
          id: `v${i + 1}`, start: r3(t), end: r3(end), kind: a.role === "photo" ? "photo" : "video", src: a.prepared, srcStart: 0,
          srcW: vi.width, srcH: vi.height, framing, fill: framing === "contain" ? inp.fills[a.id] ?? null : null,
        });
        t = end;
      });
      if (t < duration) visuals.at(-1)!.end = duration;
    }
  }

  // ---------- camera ----------
  const camera: CameraKey[] = [];
  const zoomPattern = o.cameraEnergy === 0 ? [1, 1] : o.cameraEnergy === 2 ? [1, 1.18, 1.08, 1.24] : [1, 1.12, 1.04, 1.16];
  const visualAt = (t: number) => visuals.find((v) => t >= v.start && t < v.end) ?? visuals.at(-1)!;
  /** Largest zoom ≤ z that keeps the whole head (top..chin) and face width comfortably in frame. */
  const safeZoom = (v: Visual, z: number, ax: number, ay: number, t0: number, t1: number) => {
    if (!faces || v.kind !== "video") return z;
    for (let zz = z; zz >= 1; zz -= 0.02) {
      const win = computeWindow(v.srcW, v.srcH, W, H, v.framing, { zoom: zz, ax, ay }, FACE_TARGET);
      const ok = faces.samples
        .filter((s) => s.face && s.t >= t0 && s.t <= t1)
        .every((s) => {
          const f = s.face!;
          const r = mapRect({ x0: f.x0, x1: f.x1, y0: f.headTop, y1: f.chinY }, v.srcW, v.srcH, W, H, win);
          return r.y0 >= 0.03 && r.y1 <= 0.9 && r.x0 >= 0.02 && r.x1 <= 0.98 && r.x1 - r.x0 <= 0.8;
        });
      if (ok) return r3(zz);
    }
    return 1;
  };

  let shotIndex = 0;
  for (const v of visuals) {
    if (v.kind === "photo" || v.kind === "graphic") {
      // Ken Burns: slow push across the whole slot.
      const zEnd = o.cameraEnergy === 0 ? 1 : 1.1;
      camera.push({ t: v.start, zoom: 1, ax: 0.5, ay: 0.45, move: "cut", dur: 0.9 });
      camera.push({ t: v.end, zoom: zEnd, ax: 0.5, ay: 0.42, move: "ease", dur: Math.max(0.5, v.end - v.start) });
      continue;
    }
    // Shots: split at scene cuts and at phrase boundaries every ~3.5–5 s.
    const cuts = (faces?.cuts ?? []).filter((c) => c > v.start + 0.5 && c < v.end - 0.5);
    const starts: number[] = [v.start];
    let last = v.start;
    for (const p of phrases) {
      const t = p[0]!.start;
      if (t <= v.start || t >= v.end - 1) continue;
      const hasCut = cuts.some((c) => c > last + 0.3 && c <= t + 0.05);
      if (t - last >= (o.cameraEnergy === 2 ? 2.8 : 3.6) || hasCut) {
        starts.push(r3(hasCut ? cuts.find((c) => c > last + 0.3 && c <= t + 0.05)! : t));
        last = starts.at(-1)!;
      }
    }
    starts.forEach((s0, i) => {
      const s1 = starts[i + 1] ?? v.end;
      const anchor = faces ? faceAnchor(faces, s0, s1) : null;
      const ax = anchor?.cx ?? 0.5;
      const ay = anchor?.cy ?? 0.4;
      const z = safeZoom(v, zoomPattern[shotIndex % zoomPattern.length]!, ax, ay, s0, s1);
      camera.push({ t: r3(s0), zoom: z, ax: r3(ax), ay: r3(ay), move: "cut", dur: 0.9 });
      // A smooth push-in onto an emphasised phrase inside long shots.
      if (o.cameraEnergy > 0 && s1 - s0 > 4) {
        const emph = phrases.find((p) => p[0]!.start > s0 + 1.5 && p[0]!.start < s1 - 0.8 && p.some((w) => w.emphasis));
        if (emph) {
          const zp = safeZoom(v, Math.min(1.3, z + 0.08), ax, ay, emph[0]!.start, s1);
          if (zp > z) camera.push({ t: r3(emph[0]!.start), zoom: zp, ax: r3(ax), ay: r3(ay), move: "ease", dur: 0.9 });
        }
      }
      shotIndex++;
    });
  }
  camera.sort((a, b) => a.t - b.t);

  // Face zone in OUTPUT coordinates over an interval (union of sampled positions).
  const faceZoneOut = (t0: number, t1: number, pad = 0.025): Rect | null => {
    if (!faces) return null;
    let z: Rect | null = null;
    for (const s of faces.samples) {
      if (!s.face || s.t < t0 - 0.2 || s.t > t1 + 0.2) continue;
      const v = visualAt(s.t);
      if (v.kind !== "video") continue;
      const cam = cameraAt(camera, s.t, easeInOut);
      const win = computeWindow(v.srcW, v.srcH, W, H, v.framing, cam, FACE_TARGET);
      const f = s.face;
      const fw = f.x1 - f.x0;
      const r = mapRect({ x0: f.x0 - fw * 0.18, x1: f.x1 + fw * 0.18, y0: f.headTop, y1: f.chinY }, v.srcW, v.srcH, W, H, win);
      z = z ? { x0: Math.min(z.x0, r.x0), x1: Math.max(z.x1, r.x1), y0: Math.min(z.y0, r.y0), y1: Math.max(z.y1, r.y1) } : r;
    }
    return z ? { x0: z.x0 - pad, x1: z.x1 + pad, y0: z.y0 - pad, y1: z.y1 + pad } : null;
  };

  // ---------- captions ----------
  const captions: Caption[] = [];
  const baseFont = st.size * short;
  let prevY: number | null = null;
  phrases.forEach((p, i) => {
    const start = r3(Math.max(0, p[0]!.start - 0.05));
    const nextStart = phrases[i + 1]?.[0]!.start ?? duration;
    // Keep the caption on screen through short pauses (< 1 s) so text does not blink off.
    const lastEnd = p.at(-1)!.end;
    const end = r3(nextStart - lastEnd < 1.0 ? Math.max(nextStart - 0.05, start + 0.5) : Math.min(nextStart, Math.max(lastEnd + 0.35, start + 1.0)));
    const lines = splitLines(p, st.maxCharsPerLine);
    const zone = faceZoneOut(start, end);
    const safeW = (safe.x1 - safe.x0) * W;
    const fits = (scale: number, y: number): Rect | null => {
      const px = baseFont * scale;
      const wMax = Math.max(...lines.map((l) => estTextWidth(l.map((w) => w.text).join(" "), px * (l.some((w) => w.emphasis) ? st.emphasisScale : 1), st)));
      if (wMax + px * 0.6 > safeW) return null;
      const h = (lines.length * px * st.lineHeight + px * 0.5) / H;
      const box = { x0: 0.5 - wMax / 2 / W - 0.01, x1: 0.5 + wMax / 2 / W + 0.01, y0: y, y1: y + h };
      if (!inside(box, safe)) return null;
      if (zone && overlaps(box, zone)) return null;
      return box;
    };
    const hOf = (scale: number) => (lines.length * baseFont * scale * st.lineHeight + baseFont * scale * 0.5) / H;
    let chosen: { y: number; scale: number } | null = null;
    for (const scale of [1, 0.88, 0.8, MIN_SCALE]) {
      const h = hOf(scale);
      const cands: number[] = [];
      if (prevY !== null && o.captionPosition === "auto") cands.push(prevY);
      if (o.captionPosition === "top") cands.push(safe.y0);
      else if (o.captionPosition === "middle") cands.push(0.5 - h / 2);
      else if (o.captionPosition === "bottom") cands.push(safe.y1 - h);
      else {
        if (zone) cands.push(Math.max(zone.y1 + 0.015, 0.5), zone.y1 + 0.015);
        cands.push(0.62, safe.y1 - h, zone ? zone.y0 - 0.015 - h : 0.25, safe.y0);
      }
      const ok = cands.map((y) => Math.max(safe.y0, Math.min(safe.y1 - h, y))).find((y) => fits(scale, y));
      if (ok !== undefined) {
        chosen = { y: ok, scale };
        break;
      }
    }
    if (!chosen) {
      chosen = { y: Math.max(safe.y0, safe.y1 - hOf(MIN_SCALE)), scale: MIN_SCALE };
      checks.push({ level: "error", code: "caption_layout", at: start, message: `Субтитр «${p.map((w) => w.text).join(" ")}» не помещается без перекрытия лица — нужен другой layout (меньше зум / текст сверху).` });
    }
    prevY = chosen.y;
    captions.push({
      id: `c${i + 1}`, start, end, y: r3(chosen.y), scale: chosen.scale,
      lines: lines.map((l) => l.map((w) => ({ text: w.text, start: r3(w.start), end: r3(w.end), emphasis: w.emphasis }))),
    });
  });

  // ---------- text behind the subject ----------
  const behindText: BehindText[] = [];
  if (o.behindText && faces && project.mode === "expert-video" && faces.faceCoverage > 0.6) {
    let lastT = -Infinity;
    for (const p of phrases) {
      if (behindText.length >= Math.max(1, Math.floor(duration / 15))) break;
      const w = p.find((x) => x.emphasis && x.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && x.text.length <= 12);
      if (!w || w.start < 1.5 || w.start - lastT < 12 || w.start > duration - 2) continue;
      const t0 = w.start;
      const t1 = Math.min(duration, t0 + 1.9);
      const z = faceZoneOut(t0, t1, 0);
      if (!z) continue;
      const word = w.text.replace(/[^\p{L}\p{N}%]/gu, "").toUpperCase();
      const size = Math.min(0.24, ((safe.x1 - safe.x0) * 0.96) / (word.length * 0.84));
      const textH = (size * W) / H;
      const y = z.y0 + textH * 0.12; // centre slightly below head top → head covers the lower part
      if (y - textH / 2 < safe.y0 || z.y0 > 0.55) continue;
      behindText.push({ id: `b${behindText.length + 1}`, start: r3(t0), end: r3(t1), text: word, y: r3(y), size: r3(size), matteDir: null });
      lastT = t0;
    }
  }

  // ---------- SFX (sparse, under the voice) ----------
  const sfx: Sfx[] = [];
  if (o.sfx) {
    const add = (t: number, kind: Sfx["kind"], gain: number, reason: string) => {
      if (t < 0.15 || t > duration - 0.2 || sfx.some((s) => Math.abs(s.t - t) < 1.0)) return;
      sfx.push({ t: r3(t), kind, gain, reason });
    };
    behindText.forEach((b) => add(b.start - 0.12, "whoosh", 0.2, `Жазу бастың артында: ${b.text}`));
    camera.filter((k) => k.move === "cut" && k.t > 0.3).forEach((k) => add(k.t - 0.05, "soft", 0.14, "Склейка/смена плана"));
    captions.forEach((c) => {
      const e = c.lines.flat().find((w) => w.emphasis);
      if (e) add(e.start, "pop", 0.18, `Акцент: ${e.text}`);
    });
    sfx.sort((a, b) => a.t - b.t);
  }

  // ---------- checks ----------
  if (transcript.needsReview) checks.push({ level: "warn", code: "transcript_review", at: null, message: "Текст распознан автоматически — проверьте слова на кадрах сториборда." });
  if (project.mode === "expert-video" && !faces) checks.push({ level: "warn", code: "no_face_analysis", at: null, message: "Анализ лица не выполнен — защита лица от текста не работает." });
  if (faces && faces.faceCoverage < 0.6) checks.push({ level: "warn", code: "face_coverage", at: null, message: `Лицо найдено только в ${Math.round(faces.faceCoverage * 100)}% кадров.` });
  const glyphs = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\s.,!?:;«»"'()\-–—…%№+&/@#]*$/u;
  const allText = captions.flatMap((c) => c.lines.flat().map((w) => w.text)).join(" ") + behindText.map((b) => b.text).join(" ");
  if (!glyphs.test(allText)) checks.push({ level: "warn", code: "glyphs", at: null, message: "В тексте есть символы вне кириллицы/латиницы (эмодзи и т. п.) — шрифт может их не показать." });
  if (st.active === "pill" && contrastRatio(colors.onAccent, colors.accent) < 3) checks.push({ level: "warn", code: "contrast", at: null, message: `Низкий контраст текста на плашке (${contrastRatio(colors.onAccent, colors.accent).toFixed(1)}:1).` });
  if (!captions.length) checks.push({ level: "warn", code: "no_captions", at: null, message: "Нет субтитров: речь не найдена." });

  // ---------- scenes for the storyboard ----------
  const cutTimes = camera.filter((k) => k.move === "cut").map((k) => k.t);
  let bounds = [...new Set([0, ...cutTimes.filter((t) => t > 0.3 && t < duration - 0.3)])].sort((a, b) => a - b);
  while (bounds.length > 12) {
    // merge the shortest scene with its neighbour
    let k = 1;
    let best = Infinity;
    for (let i = 1; i < bounds.length; i++) {
      const d = (bounds[i + 1] ?? duration) - bounds[i - 1]!;
      if (d < best) (best = d), (k = i);
    }
    bounds.splice(k, 1);
  }
  if (bounds.length < 4 && duration > 8) {
    // add phrase-based splits so the storyboard shows enough moments
    const extra = captions.map((c) => c.start).filter((t) => bounds.every((b) => Math.abs(b - t) > 2));
    bounds = [...bounds, ...extra.filter((_, i) => i % Math.max(1, Math.ceil(extra.length / 6)) === 0)].sort((a, b) => a - b).slice(0, 10);
  }
  const scenes: Scene[] = bounds.map((s0, i) => {
    const s1 = bounds[i + 1] ?? duration;
    const caps = captions.filter((c) => c.start < s1 && c.end > s0);
    const bt = behindText.filter((b) => b.start < s1 && b.end > s0);
    const fx = sfx.filter((x) => x.t >= s0 && x.t < s1);
    // Show a caption fully spoken (all words visible), preferring one with an emphasis word.
    const inScene = caps.filter((c) => c.lines.flat().at(-1)!.end > s0 && c.lines.flat().at(-1)!.start < s1 - 0.05);
    const keyCap = inScene.find((c) => c.lines.flat().some((w) => w.emphasis)) ?? inScene[0];
    const lastW = keyCap?.lines.flat().at(-1);
    const keyT = bt[0]
      ? Math.min(s1 - 0.05, bt[0].start + 0.9)
      : keyCap && lastW
        ? Math.max(s0, Math.min(s1 - 0.05, keyCap.end - 0.05, lastW.start + Math.max(0.08, (lastW.end - lastW.start) * 0.6)))
        : (s0 + s1) / 2;
    const cam = cameraAt(camera, keyT, easeInOut);
    const v = visualAt(keyT);
    return {
      index: i + 1, start: r3(s0), end: r3(s1), keyT: r3(keyT),
      title: bt[0] ? `Жазу артта: ${bt[0].text}` : caps[0] ? caps[0].lines.flat().map((w) => w.text).join(" ").slice(0, 40) : "—",
      onScreenText: caps.map((c) => c.lines.map((l) => l.map((w) => (w.emphasis ? `*${w.text}*` : w.text)).join(" ")).join(" / ")).join(" | "),
      camera: v.kind === "video" ? `зум ×${cam.zoom.toFixed(2)}${camera.some((k) => k.move === "ease" && k.t > s0 && k.t <= s1) ? ", плавный наезд" : ""}, ${v.framing === "contain" ? "видео в рамке + размытый фон" : "лицо в верхней трети"}` : v.kind === "photo" ? "фото, медленный наезд (Ken Burns)" : "графический фон",
      animation: `${st.label}: ${st.enter === "pop" ? "слова выпрыгивают" : st.enter === "rise" ? "слова поднимаются" : st.enter === "slide" ? "слова выезжают" : "плавное появление"}, активное слово — ${st.active === "pill" ? "плашка" : st.active === "color" ? "цвет" : st.active === "scale" ? "увеличение" : "подчёркивание"}${bt.length ? "; крупное слово за головой" : ""}`,
      sfx: fx.length ? fx.map((x) => `${x.kind} ${x.t.toFixed(1)}с`).join(", ") : "—",
      checks: checks.filter((c) => c.at !== null && c.at >= s0 && c.at < s1),
    };
  });

  return {
    schema: 1, projectId: project.id, version, updatedAt: new Date().toISOString(), mode: project.mode,
    format: o.format, platform: o.platform, width: W, height: H, fps, durationSec: r3(duration),
    style: { preset: o.style, colors, captionPosition: o.captionPosition },
    voice: { src: voice.prepared, gain: 1 },
    visuals, camera, captions, behindText, callouts: [], sfx, progressBar: o.progressBar, scenes, checks,
    transcriptNote: transcript.notes.join(" "),
  };
}
