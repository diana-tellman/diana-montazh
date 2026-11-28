import type { Faces } from "../analysis/faces";
import { faceAnchor } from "../analysis/faces";
import type { Project } from "../core/project";
import { contrastRatio, resolveStyle, type Colors, type StyleDef, type StyleOverrides, type StylePreset } from "../design/styles";
import { FORMATS, type FormatId } from "../formats";
import { chooseFraming, computeWindow, easeInOut, mapRect, type Framing } from "../layout/frame";
import { captionBand, insideSafe, overlaps, safeZone, type Platform, type Rect } from "../layout/safeZones";
import type { Transcript } from "../speech/transcript";
import type { BehindText, Callout, CameraKey, Caption, Check, Scene, Sfx, Storyboard, Visual } from "../storyboard/schema";
import { cameraAt, layoutAt } from "../storyboard/schema";
import type { Icon, Layout, Widget } from "../storyboard/schema";
import { cardRect, clipToBox, personAt } from "../layout/person";
import { autoBeats, directionsToBeats, headlineCard, mergeBeats, parseNumber, sentencePhrases, type DirectorBeat, type Directions } from "./director";
import { iconForWord } from "../design/icons";
import { groupPhrases, parseEmphasisSeq, splitLines, type TWord } from "./phrases";

export type PlanOptions = {
  format: FormatId;
  platform: Platform;
  style: StylePreset;
  colors?: Partial<Colors>;
  captionPosition: "auto" | "top" | "middle" | "bottom";
  behindText: boolean;
  sfx: boolean;
  progressBar: boolean;
  /** Preset field overrides (reference video / explicit wishes). */
  styleOverrides?: StyleOverrides;
  /** Where the style comes from, e.g. "референс: ref.mp4". */
  styleSource?: string;
  /** 3D LUT colour grade (project-relative .cube) + strength, from a reference. */
  grade?: { lut: string; strength: number; from: string } | null;
  /** 0 = static camera, 1 = normal, 2 = energetic. */
  cameraEnergy: 0 | 1 | 2;
  /** auto = split-screen moments when extra photos/clips exist; or force one layout for the whole video. */
  layout: "auto" | "full" | "circle" | "split";
  /** Animated icons on matching words. */
  icons: boolean;
  /** Meaning-driven layouts (example → window, compare → split, process → explainer). Off when layout is forced. */
  semantic?: boolean;
  /** Project-relative background music (ducked under the voice), or null. */
  music?: string | null;
};

export const DEFAULT_OPTIONS: PlanOptions = {
  format: "9:16", platform: "reels", style: "brand", captionPosition: "auto", behindText: true, sfx: true, progressBar: true, cameraEnergy: 1, layout: "auto", icons: true,
};

export type PlanInput = {
  project: Project;
  transcript: Transcript;
  faces: Faces | null;
  /** Project-relative blurred fill per video asset (contain framing). */
  fills: Record<string, string>;
  /** Project-relative colour-graded proxy per video asset (reference look). */
  graded?: Record<string, string>;
  options: PlanOptions;
  /** Claude's meaning decisions (storyboard/directions.json), or null = automatic. */
  directions?: Directions | null;
};

const FACE_TARGET = { x: 0.5, y: 0.36 };
const MIN_SCALE = 0.72;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Approximate rendered text width in px (the composition also fits text in the browser). */
export function estTextWidth(text: string, fontPx: number, st: StyleDef): number {
  const factors: Record<string, number> = { montserrat: 0.64, inter: 0.56, onest: 0.57, ptserif: 0.55, oswald: 0.45, rubik: 0.59, raleway: 0.58, nunito: 0.57, intertight: 0.53, geologica: 0.6, cormorant: 0.46, badscript: 0.52, montalt: 0.68 };
  const f = factors[st.font] ?? 0.6;
  return text.length * fontPx * f * (st.uppercase ? 1.12 : 1) + text.length * st.letterSpacing * fontPx;
}

const INTENT_LABEL: Record<string, string> = {
  example: "Мысал", compare: "Салыстыру", process: "Процесс", emotion: "Эмоция", key: "Негізгі ой", cta: "Шақыру", question: "Сұрақ", neutral: "Кадр",
};
const LAYOUT_LABEL: Record<string, string> = {
  split: "экран делится: сверху фото/видео, снизу вы", circle: "вы в круге поверх фона", full: "весь кадр",
  pip: "спикер переезжает в окно сверху, ниже — пример", compare: "экран делится: сверху сравнение А / Б, снизу вы",
  explainer: "спикер уходит из кадра, голос продолжается — полноэкранная анимация-схема",
};

/** Speech intervals (pauses < 0.35 s merged) — music is ducked there. */
export function speechSpans(words: TWord[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const w of words) {
    const last = out.at(-1);
    if (last && w.start - last[1] < 0.35) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out.map(([a, b]) => [r3(a), r3(b)]);
}

export function buildStoryboard(inp: PlanInput, version = 1): Storyboard {
  const { project, transcript, faces, options: o } = inp;
  const fmt = FORMATS[o.format];
  const W = fmt.width;
  const H = fmt.height;
  const short = Math.min(W, H);
  const safe = safeZone(o.platform);
  const st = resolveStyle(o.style, o.styleOverrides);
  const colors: Colors = { ...st.colors, ...(o.colors ?? {}) };
  const fps = 30;
  const voice = project.assets.find((a) => a.id === project.voiceAssetId);
  if (!voice) throw new Error("Нет голосовой записи");
  const duration = Math.max(0.5, voice.info.durationSec || transcript.durationMs / 1000);
  const checks: Check[] = [];

  // ---------- words & phrases ----------
  const allW = transcript.segments.flatMap((s) => s.words);
  const emph = parseEmphasisSeq(allW.map((w) => w.text));
  const words: TWord[] = allW.map((w, i) => {
    const e = emph[i]!;
    return { text: st.uppercase ? e.text.toUpperCase() : e.text, start: w.startMs / 1000, end: w.endMs / 1000, emphasis: e.emphasis };
  });
  // One-word style (reference): only very short words (≤ 4 letters, < 0.25 s) join a neighbour.
  const phrases = groupPhrases(words, { maxWords: st.maxWordsPerPhrase, maxChars: st.maxWordsPerPhrase === 1 ? st.maxCharsPerLine : st.maxCharsPerLine * 2 - 2, pause: 0.45, minDur: st.maxWordsPerPhrase === 1 ? 0.2 : 0.6 });
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
      id: "v1", start: 0, end: duration, kind: "video", src: inp.graded?.[mainVideo.id] ?? mainVideo.prepared, srcStart: 0, srcW: v.width, srcH: v.height, framing,
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

  /** On-screen window of caption i (same formula as the caption builder below). */
  const capWindow = (i: number) => {
    const p = phrases[i]!;
    const start = Math.max(0, p[0]!.start - 0.05);
    const nextStart = phrases[i + 1]?.[0]!.start ?? duration;
    const lastEnd = p.at(-1)!.end;
    const end = nextStart - lastEnd < 1.0 ? Math.max(nextStart - 0.05, start + 0.5) : Math.min(nextStart, Math.max(lastEnd + 0.35, start + 1.0));
    return { start, end };
  };

  // ---------- meaning → beats (what is said decides how the frame is built) ----------
  const hasPerson = project.mode === "expert-video" && !!mainVideo?.info.video;
  // Meaning is read per sentence; layouts still snap to caption boundaries (same word objects).
  const sp = sentencePhrases(words);
  const capIdx = new Map<TWord, number>();
  phrases.forEach((p, i) => p.forEach((w) => capIdx.set(w, i)));
  const cwStart = (w: TWord) => capWindow(capIdx.get(w) ?? 0).start;
  const cwEnd = (w: TWord) => capWindow(capIdx.get(w) ?? phrases.length - 1).end;
  const bFirst = (b: DirectorBeat) => b.w0 ?? sp[b.p0]![0]!;
  const bLast = (b: DirectorBeat) => b.w1 ?? sp[b.p1]!.at(-1)!;
  const bWords = (b: DirectorBeat) => words.filter((w) => w.start >= bFirst(b).start && w.end <= bLast(b).end);
  const auto = autoBeats({ phrases: sp, duration, hasPerson });
  const manual = inp.directions ? directionsToBeats(inp.directions, sp) : [];
  const beats: DirectorBeat[] = mergeBeats(auto, manual, inp.directions?.replaceAuto ?? false);
  const semantic = o.semantic !== false && o.layout === "auto";

  // ---------- layouts (full / circle / split / pip window / compare / explainer) ----------
  const layouts: Layout[] = [];
  const secondaries = project.mode === "expert-video" ? project.assets.filter((a) => a.role === "photo" || a.role === "broll-video") : [];
  const sec = (i: number) => {
    const a = secondaries[i % Math.max(1, secondaries.length)];
    if (!a?.info.video) return { secondary: null, secondaryKind: "graphic" as const, secondaryW: W, secondaryH: H };
    return { secondary: a.prepared, secondaryKind: a.role === "photo" ? ("photo" as const) : ("video" as const), secondaryW: a.info.video.width, secondaryH: a.info.video.height };
  };
  const graphicSec = { secondary: null, secondaryKind: "graphic" as const, secondaryW: W, secondaryH: H };
  let usedSec = 0;
  if (semantic) {
    for (const b of beats) {
      if (!b.card || !(b.intent === "example" || b.intent === "compare" || b.intent === "process" || b.intent === "list" || (b.intent === "number" && !hasPerson))) continue;
      const start = r3(cwStart(bFirst(b)));
      const end = r3(Math.min(duration, cwEnd(bLast(b))));
      if (end - start < 1.2 || layouts.some((l) => start < l.end && end > l.start)) continue;
      // Without a speaker on screen every meaning layout is a full-screen explainer graphic.
      const kind = !hasPerson ? "explainer" : b.intent === "example" ? "pip" : b.intent === "compare" ? "compare" : "explainer";
      if (b.intent === "number" && end - start < 1.8) continue;
      const media = kind === "pip" && usedSec < secondaries.length ? sec(usedSec++) : graphicSec;
      layouts.push({ id: `l${layouts.length + 1}`, start, end, kind, ...media, shape: kind === "pip" ? b.shape ?? "rounded" : undefined, intent: b.intent, card: b.card });
    }
  }
  // Voice only (no speaker, no photos): every moment gets an explainer card — headline / counter between the meaning scenes.
  const voiceOnly = project.mode === "voice-over-visuals" && visuals.every((v) => v.kind === "graphic");
  if (semantic && voiceOnly) {
    let i = 0;
    while (i < sp.length) {
      const s0 = cwStart(sp[i]![0]!);
      if (layouts.some((l) => s0 >= l.start - 0.01 && s0 < l.end - 0.05)) { i++; continue; }
      let j = i;
      // One card per sentence; very short sentences are joined (≥ 2.4 s on screen).
      while (j + 1 < sp.length && cwEnd(sp[j]!.at(-1)!) - s0 < 2.4 && !layouts.some((l) => cwStart(sp[j + 1]![0]!) >= l.start - 0.01 && cwStart(sp[j + 1]![0]!) < l.end - 0.05)) j++;
      const e0 = Math.min(duration, cwEnd(sp[j]!.at(-1)!));
      const ws = sp.slice(i, j + 1).flat();
      const n = parseNumber(ws);
      const card = n ? { variant: "counter" as const, title: "", label: n.label || undefined, value: n.value, suffix: n.suffix, items: [{ text: `${n.value}`, icon: null, at: n.at }] } : headlineCard(ws);
      if (card && e0 - s0 >= 0.6) layouts.push({ id: "x", start: r3(s0), end: r3(e0), kind: "explainer", ...graphicSec, intent: n ? "number" : "neutral", card });
      i = j + 1;
    }
    // No empty background between scenes: each scene lasts until the next one starts.
    layouts.sort((a, b) => a.start - b.start);
    layouts.forEach((l, k) => {
      if (k === 0) l.start = 0;
      l.end = r3(layouts[k + 1]?.start ?? duration);
    });
  }
  if (project.mode === "expert-video") {
    if (o.layout === "circle" || o.layout === "split") {
      const n = Math.max(1, secondaries.length);
      for (let i = 0; i < n; i++) layouts.push({ id: `l${i + 1}`, start: r3((i * duration) / n), end: r3(((i + 1) * duration) / n), kind: o.layout, ...sec(i) });
    } else if (o.layout === "auto" && secondaries.length > usedSec) {
      // One split-screen moment per remaining photo/clip, on phrase boundaries, spread across the video.
      // Boundaries coincide with caption boundaries, so no caption straddles two layouts.
      secondaries.slice(usedSec).forEach((_, k) => {
        const i = usedSec + k;
        const ideal = ((k + 1) * duration) / (secondaries.length - usedSec + 1);
        let a = 0;
        phrases.forEach((p, q) => {
          if (Math.abs(p[0]!.start - ideal) < Math.abs(phrases[a]![0]!.start - ideal)) a = q;
        });
        let b = a;
        while (b + 1 < phrases.length && capWindow(b).end - capWindow(a).start < 2.5) b++;
        const start = capWindow(a).start;
        const end = Math.min(duration, capWindow(b).end);
        if (layouts.some((l) => start < l.end + 1 && end > l.start - 1)) return;
        layouts.push({ id: `l${layouts.length + 1}`, start: r3(start), end: r3(end), kind: "split", ...sec(i) });
      });
    }
  }
  layouts.sort((a, b) => a.start - b.start);
  layouts.forEach((l, i) => (l.id = `l${i + 1}`));
  /** Card areas active in [t0, t1] — no caption, icon or plate may cover them. */
  const blockedAt = (t0: number, t1: number): Rect[] =>
    layouts.filter((l) => l.start < t1 && l.end > t0 && l.card).map((l) => cardRect(l.kind)).filter((r): r is Rect => !!r);

  // ---------- emotion: speaker full frame + slow push-in onto the face ----------
  if (o.cameraEnergy > 0) {
    for (const b of beats.filter((x) => x.intent === "emotion")) {
      const s0 = bFirst(b).start;
      const s1 = Math.min(duration, bLast(b).end + 0.3);
      if (s1 - s0 < 0.8 || layouts.some((l) => s0 < l.end && s1 > l.start)) continue;
      const v = visualAt(s0);
      if (v.kind !== "video") continue;
      const base = cameraAt(camera, s0, (x) => x);
      if (camera.some((k) => k.t > s0 && k.t < s1)) continue; // a cut already happens here
      const zp = safeZoom(v, Math.min(1.35, base.zoom + 0.12), base.ax, base.ay, s0, s1);
      if (zp <= base.zoom + 0.02) continue;
      camera.push({ t: r3(s0 + 0.6), zoom: zp, ax: r3(base.ax), ay: r3(base.ay), move: "ease", dur: 0.6 });
      const nextKey = camera.filter((k) => k.t > s1).sort((x, y) => x.t - y.t)[0];
      if (!nextKey || nextKey.t - s1 > 0.6) camera.push({ t: r3(Math.min(duration, s1 + 0.4)), zoom: base.zoom, ax: r3(base.ax), ay: r3(base.ay), move: "ease", dur: 0.4 });
    }
    camera.sort((a, b) => a.t - b.t);
  }

  // Face zone in OUTPUT coordinates over an interval (union of sampled positions).
  const faceZoneOut = (t0: number, t1: number, pad = 0.025): Rect | null => {
    if (!faces) return null;
    let z: Rect | null = null;
    for (const s of faces.samples) {
      if (!s.face || s.t < t0 - 0.2 || s.t > t1 + 0.2) continue;
      // The safety margin never reaches into a different layout.
      if (layoutAt(layouts, s.t) !== layoutAt(layouts, Math.min(t1 - 0.001, Math.max(t0, s.t)))) continue;
      const v = visualAt(s.t);
      if (v.kind !== "video") continue;
      const cam = cameraAt(camera, s.t, easeInOut);
      const pa = personAt(layouts, s.t, v.srcW, v.srcH, W, H, v.framing, cam, true);
      if (!pa.visible) continue;
      const f = s.face;
      const fw = f.x1 - f.x0;
      const r = clipToBox(mapRect({ x0: f.x0 - fw * 0.18, x1: f.x1 + fw * 0.18, y0: f.headTop, y1: f.chinY }, v.srcW, v.srcH, W, H, pa.window), pa.box, W, H);
      if (r.y1 <= r.y0 || r.x1 <= r.x0) continue;
      z = z ? { x0: Math.min(z.x0, r.x0), x1: Math.max(z.x1, r.x1), y0: Math.min(z.y0, r.y0), y1: Math.max(z.y1, r.y1) } : r;
    }
    return z ? { x0: z.x0 - pad, x1: z.x1 + pad, y0: z.y0 - pad, y1: z.y1 + pad } : null;
  };

  // ---------- captions ----------
  const captions: Caption[] = [];
  const baseFont = st.size * short;
  let prevY: number | null = null;
  phrases.forEach((p, i) => {
    const cw = capWindow(i);
    const start = r3(cw.start);
    // Keeps the caption on screen through short pauses (< 1 s) so text does not blink off.
    const end = r3(cw.end);
    const lines = splitLines(p, st.maxCharsPerLine);
    const zone = faceZoneOut(start, end);
    const blocked = blockedAt(start, end);
    const fits = (scale: number, y: number): Rect | null => {
      const px = baseFont * scale;
      const wMax = Math.max(...lines.map((l) => estTextWidth(l.map((w) => w.text).join(" "), px * (l.some((w) => w.emphasis) ? st.emphasisScale : 1), st)));
      const h = (lines.length * px * st.lineHeight + px * 0.5) / H;
      // Narrower band where the text reaches the platform's button column (lower right).
      const band = captionBand(safe, y + h);
      if (wMax + px * 0.6 > (band.x1 - band.x0) * W) return null;
      const box = { x0: 0.5 - wMax / 2 / W - 0.01, x1: 0.5 + wMax / 2 / W + 0.01, y0: y, y1: y + h };
      if (!insideSafe(box, safe)) return null;
      if (zone && overlaps(box, zone)) return null;
      if (blocked.some((b) => overlaps(box, b))) return null;
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
        // Style preference first (e.g. chest level), then as low as possible above the platform's blind zone.
        if (st.preferY != null && layoutAt(layouts, start + 0.05) === "full") cands.push(st.preferY);
        cands.push(safe.y1 - h);
        if (zone) cands.push(zone.y1 + 0.015);
        if (layoutAt(layouts, start + 0.05) === "split") cands.push(0.5 - h - 0.012, 0.5 - h / 2);
        if (layoutAt(layouts, start + 0.05) === "compare") cands.push(0.5 - h - 0.012, 0.5 + 0.012);
        cands.push(0.62, zone ? zone.y0 - 0.015 - h : 0.25, safe.y0);
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
    chosen.y = Math.floor(chosen.y * 1000) / 1000; // never round down into the blind zone
    prevY = chosen.y;
    captions.push({
      id: `c${i + 1}`, start, end, y: chosen.y, scale: chosen.scale,
      lines: lines.map((l) => l.map((w) => ({ text: w.text, start: r3(w.start), end: r3(w.end), emphasis: w.emphasis }))),
    });
  });

  // ---------- posters: small label / BIG word behind the head / script line / count-up numbers ----------
  const behindText: BehindText[] = [];
  const strip = (t: string) => t.replace(/^[«"(*]+|[»".,!?:;)*…—-]+$/gu, "");
  const bigFactor: Record<string, number> = { oswald: 0.5, montserrat: 0.84, intertight: 0.66, geologica: 0.72, onest: 0.7, inter: 0.7, rubik: 0.74, raleway: 0.72, nunito: 0.72, ptserif: 0.7, cormorant: 0.6, badscript: 0.6 };
  if (o.behindText && faces && project.mode === "expert-video" && faces.faceCoverage > 0.6) {
    type Cand = { t0: number; t1: number; big: string; label?: string; script?: string; count?: BehindText["count"]; scriptAt?: number; why: string };
    const cands: Cand[] = [];
    // Hook: the first phrase gets a headline (label + BIG keyword + script tail).
    const p0 = sp.find((p) => p[0]!.start < 2.5 && p.length >= 2);
    if (p0) {
      const hc = headlineCard(p0);
      const key = hc?.items[0];
      if (key && key.text.length <= 12) cands.push({ t0: Math.max(0, p0[0]!.start - 0.05), t1: Math.min(duration, p0[0]!.start + 3, Math.max(p0.at(-1)!.end + 0.5, p0[0]!.start + 2.2)), big: key.text.toUpperCase(), label: hc!.label, script: hc!.script, scriptAt: p0.find((w) => strip(w.text) === hc!.script?.split(" ")[0])?.start, why: "hook" });
    }
    // Numbers: count up in the big line.
    for (const b of beats.filter((x) => x.intent === "number" && x.card?.value !== undefined)) {
      const ph = bWords(b);
      const v = b.card!.value!;
      if (v >= 100 && b.card!.suffix !== "%") continue; // big audience numbers → glass counter widget
      cands.push({ t0: Math.max(0, ph[0]!.start - 0.05), t1: Math.min(duration, Math.max(ph.at(-1)!.end + 0.6, ph[0]!.start + 2.2)), big: `${v}${b.card!.suffix === "%" ? "%" : ""}`, label: b.card!.label, script: b.card!.suffix && b.card!.suffix !== "%" ? b.card!.suffix : undefined, count: { from: 0, to: v, prefix: "", suffix: b.card!.suffix === "%" ? "%" : "" }, why: "number" });
    }
    // Emphasis words (one per ~12 s), read per sentence so "*Claude Code*" stays together.
    for (const p of sp) {
      const k = p.findIndex((x) => x.emphasis && !/\d/.test(x.text) && x.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && x.text.length <= 12);
      if (k < 0) continue;
      // A *multi word* accent ("Claude Code") stays together when it is short.
      let big = strip(p[k]!.text);
      if (p[k + 1]?.emphasis && !/\d/.test(p[k + 1]!.text) && (big + " " + strip(p[k + 1]!.text)).length <= 14) big += " " + strip(p[k + 1]!.text);
      const w = p[k]!;
      if (w.start >= 1.5 && w.start <= duration - 2) cands.push({ t0: w.start, t1: Math.min(duration, w.start + 1.9), big: big.toUpperCase(), why: "emphasis" });
    }
    cands.sort((x, y) => x.t0 - y.t0);
    const maxN = Math.max(1, Math.floor(duration / 8));
    for (const c of cands) {
      if (behindText.length >= maxN) break;
      if (behindText.some((b) => c.t0 < b.end + (c.why === "emphasis" ? 10 : 1.5) && c.t1 > b.start - 1.5)) continue;
      // Shorten a poster that runs into the next layout (it must be gone before the speaker moves).
      const nextL = layouts.find((l) => l.kind !== "full" && l.start > c.t0 && l.start < c.t1);
      if (nextL) c.t1 = Math.max(c.t0, nextL.start - 0.1);
      if (c.t1 - c.t0 < 1.3 || layouts.some((l) => l.kind !== "full" && c.t0 < l.end && c.t1 > l.start)) continue;
      const z = faceZoneOut(c.t0, c.t1, 0);
      if (!z) continue;
      const word = c.big.replace(/[^\p{L}\p{N}% ]/gu, "").trim();
      if (!word) continue;
      let size = Math.min(c.why === "emphasis" ? 0.24 : 0.26, ((safe.x1 - safe.x0) * 0.96) / (word.length * (bigFactor[st.titleFont] ?? 0.8)));
      let textH = (size * W) / H;
      const labelH = c.label ? 0.035 : 0;
      // Captions saying exactly the poster words disappear while it shows, so they do not block it.
      const pw = new Set([c.label, c.big, c.script].filter(Boolean).join(" ").split(/\s+/).map((x) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
      const capBoxes = captions
        .filter((k) => k.start < c.t1 && k.end > c.t0 && !k.lines.flat().every((w) => pw.has(w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))))
        .map((k) => ({ y0: k.y - 0.01, y1: k.y + (k.lines.length * st.size * short * k.scale * st.lineHeight + st.size * short * 0.5) / H + 0.01 }));
      const freeY = (y0: number, y1: number) => y0 >= safe.y0 && y1 <= safe.y1 && !capBoxes.some((k) => y0 < k.y1 && y1 > k.y0);
      let y = z.y0 + textH * 0.12; // centre slightly below head top → head covers the lower part
      let front = false;
      let under = false;
      if (y - textH / 2 - labelH < safe.y0 || z.y0 > 0.55) {
        // No room behind the head → above the head in front, else under the chin (reference «эти эффекты / 10 МИНУТ»).
        y = z.y0 - 0.012 - textH / 2;
        front = true;
        if (y - textH / 2 - labelH < safe.y0) {
          // Under the chin: shrink the big line to the free band above the captions.
          const top = z.y1 + 0.015;
          const bottom = Math.min(safe.y1, ...capBoxes.map((k) => k.y0).filter((v) => v > top));
          const fitH = Math.min(textH, bottom - top - labelH - 0.005);
          if (fitH < 0.045) continue;
          size = (fitH * H) / W;
          textH = fitH;
          y = top + labelH + textH / 2;
          under = true;
          if (!freeY(y - textH / 2 - labelH, y + textH / 2)) continue;
        }
      }
      // Script line goes under the chin (or under the poster), never on the face or on a caption.
      let script = c.script;
      const sy = under ? y + textH / 2 + 0.004 : z.y1 + 0.012;
      if (script && !freeY(sy, sy + 0.05)) script = undefined;
      behindText.push({
        id: `b${behindText.length + 1}`, start: r3(c.t0), end: r3(c.t1), text: word, y: r3(y), size: r3(size), matteDir: null,
        ...(c.label ? { label: c.label, labelAt: r3(c.t0) } : {}), ...(script ? { script, scriptY: r3(sy), scriptAt: r3(Math.max(c.t0 + 0.3, c.scriptAt ?? c.t0 + 0.5)) } : {}),
        ...(c.count ? { count: c.count } : {}), ...(front ? { front: true } : {}),
      });
    }
    behindText.sort((x, y) => x.start - y.start).forEach((b, i) => (b.id = `b${i + 1}`));
  }

  // ---------- icons on matching words ----------
  const icons: Icon[] = [];
  if (o.icons) {
    const maxIcons = Math.max(1, Math.ceil(duration / 4.5));
    for (const w of words) {
      if (icons.length >= maxIcons) break;
      const name = iconForWord(w.text);
      if (!name || icons.some((ic) => w.start - ic.start < 3.5) || w.start > duration - 1) continue;
      const t0 = Math.max(0, w.start - 0.1);
      const t1 = Math.min(duration, t0 + 1.8);
      if (behindText.some((b) => t0 < b.end && t1 > b.start)) continue;
      if (layouts.some((l) => l.kind !== "full" && t0 < l.end + 0.3 && t1 > l.start - 0.3)) continue; // cards carry their own icons
      const size = 0.17;
      const r = size / 2;
      const rh = (r * W) / H;
      const zone = faceZoneOut(t0, t1);
      const caps = captions.filter((c) => c.start < t1 && c.end > t0).map((c) => ({ x0: 0.1, x1: 0.9, y0: c.y - 0.01, y1: c.y + (c.lines.length * st.size * short * c.scale * st.lineHeight + st.size * short * 0.5) / H + 0.01 }));
      const cands: Array<[number, number]> = zone
        ? [[0.5, zone.y0 - rh - 0.015], [zone.x1 + r + 0.03, (zone.y0 + zone.y1) / 2], [zone.x0 - r - 0.03, (zone.y0 + zone.y1) / 2], [0.5, safe.y0 + rh + 0.02]]
        : [[0.5, 0.3], [0.5, safe.y0 + rh + 0.04]];
      const ok = cands.find(([x, y]) => {
        const box = { x0: x - r, x1: x + r, y0: y - rh, y1: y + rh };
        const bnd = captionBand(safe, box.y1);
        return box.x0 >= bnd.x0 && box.x1 <= bnd.x1 && box.y0 >= safe.y0 && box.y1 <= safe.y1 && !(zone && overlaps(box, zone)) && !caps.some((c) => overlaps(box, c));
      });
      if (!ok) continue;
      icons.push({ id: `i${icons.length + 1}`, start: r3(t0), end: r3(t1), name, x: r3(ok[0]), y: r3(ok[1]), size, word: w.text });
    }
  }

  // ---------- key thought / call to action → plate (above the head, never on face or captions) ----------
  const callouts: Callout[] = [];
  const capBox = (c: Caption) => ({ x0: 0.08, x1: 0.92, y0: c.y - 0.01, y1: c.y + (c.lines.length * st.size * short * c.scale * st.lineHeight + st.size * short * 0.5) / H + 0.01 });
  for (const b of beats.filter((x) => (x.intent === "key" || x.intent === "cta") && x.plate)) {
    const t0 = r3(Math.max(0, bFirst(b).start - 0.05));
    const t1 = r3(Math.min(duration, Math.max(t0 + 2.2, bLast(b).end + 0.6)));
    if (layouts.some((l) => l.kind !== "full" && t0 < l.end && t1 > l.start)) continue;
    if (behindText.some((x) => t0 < x.end && t1 > x.start)) continue;
    const text = b.plate!.length > 26 ? b.plate!.split(" ").reduce((acc, w) => ((acc + " " + w).trim().length <= 24 ? (acc + " " + w).trim() : acc), "") : b.plate!;
    const hh = 0.05;
    const zone = faceZoneOut(t0, t1, 0.01);
    const caps = captions.filter((c) => c.start < t1 && c.end > t0).map(capBox);
    // Preferred: above the head, top of the safe zone, under the chin; then any free row (closest to the head first).
    const scan = Array.from({ length: Math.floor((safe.y1 - hh - safe.y0) / 0.01) + 1 }, (_, k) => safe.y0 + k * 0.01).sort((a, b) => Math.abs(a - (zone?.y1 ?? 0.3)) - Math.abs(b - (zone?.y1 ?? 0.3)));
    const cands = [zone ? zone.y0 - hh - 0.02 : 0.2, safe.y0 + 0.01, zone ? zone.y1 + 0.02 : 0.5, ...scan];
    const wN = Math.min(0.84, (text.length * 0.042 * 0.6 * W + 0.042 * W * 1.8) / W);
    const y = cands.find((yy) => {
      const box = { x0: 0.5 - wN / 2, x1: 0.5 + wN / 2, y0: yy, y1: yy + hh };
      return insideSafe(box, safe) && !(zone && overlaps(box, zone)) && !caps.some((c) => overlaps(box, c));
    });
    if (y === undefined || !text) continue;
    const prev = callouts.at(-1);
    if (prev && prev.end > t0 - 0.05) prev.end = r3(Math.max(prev.start + 0.8, t0 - 0.05));
    callouts.push({ id: `k${callouts.length + 1}`, start: t0, end: t1, text: st.titleUppercase && b.intent === "key" ? text.toUpperCase() : text, kind: b.intent === "cta" ? "cta" : "glass", y: r3(y) });
  }

  // ---------- glass widgets next to the speaker, each on its spoken word ----------
  const widgets: Widget[] = [];
  if (project.mode === "expert-video" && o.icons) {
    const WK: Array<[Widget["kind"], RegExp]> = [
      ["notify", /^(instagram|инстаграм|инста|хабарлама|уведомл|notification|жазылушы|подписчик|оқырман|follower)/],
      ["search", /^(ізде|іздеу|іздесең|google|гугл|поиск|ищ|search|найд|табасың|табу)/],
      ["toggle", /^(қосасың|қосу|қосып|қос|автомат|включ|enable|активир|turn)/],
      ["comment", /^(коммент|пікір|comment)/],
    ];
    const occupied = (t0: number, t1: number): Rect[] => [
      ...captions.filter((c) => c.start < t1 && c.end > t0).map(capBox),
      ...callouts.filter((c) => c.start < t1 && c.end > t0).map((c) => ({ x0: 0.08, x1: 0.92, y0: c.y - 0.01, y1: c.y + 0.06 })),
      ...behindText.filter((b) => b.start < t1 && b.end > t0).flatMap((b) => {
        const hh = (b.size * W) / H;
        const r = [{ x0: 0.04, x1: 0.96, y0: b.y - hh / 2 - (b.label ? 0.04 : 0), y1: b.y + hh / 2 }];
        if (b.scriptY !== undefined) r.push({ x0: 0.1, x1: 0.9, y0: b.scriptY, y1: b.scriptY + 0.06 });
        return r;
      }),
      ...widgets.filter((x) => x.start < t1 && x.end > t0).map((x) => ({ x0: x.x - x.w / 2, x1: x.x + x.w / 2, y0: x.y - 0.06, y1: x.y + 0.06 })),
    ];
    const place = (kind: Widget["kind"], t0: number, t1: number) => {
      const banner = kind === "notify" || kind === "search" || kind === "comment";
      const w = banner ? 0.8 : 0.34;
      const hN = banner ? 0.075 : (0.34 * W * 0.62) / H;
      const zone = faceZoneOut(t0, t1, 0.015);
      const occ = occupied(t0, t1);
      const pts: Array<[number, number]> = banner
        ? [[0.5, safe.y0 + hN / 2 + 0.01], [0.5, (zone?.y1 ?? 0.45) + hN / 2 + 0.015], [0.5, 0.5], [0.5, 0.58], [0.5, 0.64]]
        : [[0.26, 0.3], [0.74, 0.3], [0.26, 0.5], [0.74, 0.5], [0.26, 0.4], [0.74, 0.4], [0.26, 0.56], [0.74, 0.56], [0.5, 0.56], [0.26, 0.62], [0.5, 0.62], [0.26, 0.2], [0.74, 0.2]];
      return pts.find(([x, y]) => {
        const box = { x0: x - w / 2, x1: x + w / 2, y0: y - hN / 2, y1: y + hN / 2 };
        return insideSafe(box, safe) && !(zone && overlaps(box, zone)) && !occ.some((r) => overlaps(box, r));
      })?.concat([w]) as [number, number, number] | undefined;
    };
    const maxW = Math.max(1, Math.floor(duration / 3));
    const push = (kind: Widget["kind"], at: number, text: string, word: string, value?: number) => {
      if (widgets.length >= maxW || widgets.some((x) => Math.abs(x.start - at) < 2.5)) return;
      const t0 = r3(Math.max(0, at - 0.08));
      const t1 = r3(Math.min(duration, at + (kind === "search" || kind === "comment" ? 2.8 : 2.4)));
      if (layouts.some((l) => l.kind !== "full" && t0 < l.end && t1 > l.start)) return;
      const pl = place(kind, t0, t1);
      if (!pl) return;
      widgets.push({ id: `w${widgets.length + 1}`, start: t0, end: t1, kind, x: r3(pl[0]), y: r3(pl[1]), w: pl[2], text: text.slice(0, 34), value, word });
    };
    // Numbers that were not shown as a poster: audience size → counter, percent → ring, time → timer.
    for (const b of beats.filter((x) => x.intent === "number" && x.card?.value !== undefined)) {
      const at = b.card!.items[0]!.at;
      if (behindText.some((x) => x.count && Math.abs(x.start - at) < 1)) continue;
      const suf = (b.card!.suffix ?? "").toLowerCase();
      const v = b.card!.value!;
      if (suf === "%") push("ring", at, b.card!.label || suf, String(v), v);
      else if (/^(минут|мин|секунд|сек|сағат|час|minute|second|hour)/.test(suf)) push("timer", at, `${v} ${b.card!.suffix}`, String(v), /^(сағат|час|hour)/.test(suf) ? v * 3600 : /^(минут|мин|minute)/.test(suf) ? v * 60 : v);
      else push("counter", at, b.card!.suffix || b.card!.label || "", String(v), v);
    }
    phrases.forEach((p) => {
      for (const wd of p) {
        const k = wd.text.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
        const hit = WK.find(([, re]) => re.test(k));
        if (!hit) continue;
        const rest = p.map((x) => strip(x.text)).join(" ");
        const quoted = p.map((x) => x.text).join(" ").match(/[«"]([^»"]+)[»"]/)?.[1] ?? p.find((x) => x.emphasis)?.text;
        push(hit[0], wd.start, hit[0] === "comment" ? strip(quoted ?? rest) : hit[0] === "notify" ? rest : hit[0] === "search" ? rest.toLowerCase() : rest, wd.text);
        break;
      }
    });
    widgets.sort((a, b) => a.start - b.start).forEach((x, i) => (x.id = `w${i + 1}`));
  }

  // Plates win over keyword icons at the same moment (one accent at a time).
  for (let i = icons.length - 1; i >= 0; i--) if ([...callouts, ...widgets].some((k) => icons[i]!.start < k.end && icons[i]!.end > k.start)) icons.splice(i, 1);
  icons.forEach((ic, i) => (ic.id = `i${i + 1}`));

  // A plate never duplicates the subtitle: captions whose words are all on the plate are dropped while it shows.
  const nw = (x: string) => x.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
  for (const k of [...callouts, ...behindText.map((b) => ({ start: b.start, end: b.end, text: [b.label, b.text, b.script].filter(Boolean).join(" ") }))]) {
    const on = new Set(k.text.split(/\s+/).map(nw).filter(Boolean));
    for (let i = captions.length - 1; i >= 0; i--) {
      const c = captions[i]!;
      if (c.start < k.start - 0.1 || c.start >= k.end) continue;
      if (c.lines.flat().every((w) => on.has(nw(w.text)))) captions.splice(i, 1);
    }
  }

  // ---------- SFX (sparse, under the voice) ----------
  const sfx: Sfx[] = [];
  if (o.sfx) {
    // Timing rules measured on the reference reels:
    //  voice-only explainer ≈ 1 sound / s, exactly on each element (lag ≈ 0);
    //  expert on camera ≈ 1 sound / 3 s, only on graphics, ~0.1 s after the motion starts; whoosh leads a scene change by ~0.15 s.
    const gap = voiceOnly ? 0.6 : 1.2;
    const add = (t: number, kind: Sfx["kind"], gain: number, reason: string) => {
      if (t < 0.15 || t > duration - 0.2 || sfx.some((s) => Math.abs(s.t - t) < gap)) return;
      sfx.push({ t: r3(t), kind, gain, reason });
    };
    const lag = voiceOnly ? 0 : 0.1;
    behindText.forEach((b) => add(b.start - 0.12, "whoosh", 0.2, `Жазу бастың артында: ${b.text}`));
    behindText.filter((b) => b.count).forEach((b) => add(b.start + 0.1, "tickroll", 0.15, `Санау: ${b.text}`));
    layouts.forEach((l, i) => {
      const joined = i > 0 && Math.abs(layouts[i - 1]!.end - l.start) < 0.02;
      add(l.start - 0.15, l.kind === "explainer" ? (joined ? "swipe" : "whoosh") : "whoosh", joined ? 0.13 : 0.16, `Макет: ${l.kind}`);
    });
    // Each card element sounds exactly when it appears (= when its word is spoken).
    const cardSfx = (v: string, k: number): Sfx["kind"] => (v === "steps" || v === "flow" ? "click" : v === "compare" && k === 1 ? "impact" : v === "counter" ? "tickroll" : "pop");
    layouts.forEach((l) => l.card?.items.forEach((it, k) => add(it.at + lag, cardSfx(l.card!.variant, k), l.card!.variant === "compare" && k === 1 ? 0.14 : 0.15, `Карточка: ${it.text}`)));
    callouts.forEach((c) => add(c.start + lag, c.kind === "cta" ? "pop" : "soft", 0.15, `Плашка: ${c.text}`));
    const wsfx: Record<Widget["kind"], Sfx["kind"]> = { counter: "tickroll", ring: "tickroll", search: "type", comment: "type", notify: "ding", toggle: "click", timer: "tick" };
    widgets.forEach((x) => add(x.start + (x.kind === "search" || x.kind === "comment" ? 0.25 : 0.1), wsfx[x.kind], x.kind === "notify" ? 0.14 : 0.16, `Виджет ${x.kind}: ${x.text}`));
    icons.forEach((ic) => add(ic.start + lag, "pop", 0.16, `Иконка: ${ic.name}`));
    // Plain jump cuts of the speaker stay silent (as in the references); only real scene changes get a sound.
    if (!hasPerson) camera.filter((k) => k.move === "cut" && k.t > 0.3).forEach((k) => add(k.t - 0.05, "soft", 0.14, "Смена плана"));
    captions.forEach((c) => {
      const e = c.lines.flat().find((w) => w.emphasis);
      if (e) add(e.start, "pop", 0.16, `Акцент: ${e.text}`);
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
  // Every meaning layout gets its own storyboard frame (start and the return to full frame).
  const pinned = new Set(layouts.flatMap((l) => [l.start, l.end]).filter((t) => t > 0.3 && t < duration - 0.3).map(r3));
  let bounds = [...new Set([0, ...cutTimes.filter((t) => t > 0.3 && t < duration - 0.3 && ![...pinned].some((p) => Math.abs(p - t) < 0.6)), ...pinned])].sort((a, b) => a - b);
  while (bounds.length > 12) {
    // merge the shortest scene with its neighbour (never remove a layout boundary)
    let k = -1;
    let best = Infinity;
    for (let i = 1; i < bounds.length; i++) {
      if (pinned.has(bounds[i]!)) continue;
      const d = (bounds[i + 1] ?? duration) - bounds[i - 1]!;
      if (d < best) (best = d), (k = i);
    }
    if (k < 0) break;
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
    const lay = layouts.filter((l) => l.start < s1 && l.end > s0);
    const ics = icons.filter((x) => x.start < s1 && x.end > s0);
    const fx = sfx.filter((x) => x.t >= s0 && x.t < s1);
    // Show a caption fully spoken (all words visible), preferring one with an emphasis word.
    const inScene = caps.filter((c) => c.lines.flat().at(-1)!.end > s0 && c.lines.flat().at(-1)!.start < s1 - 0.05);
    const keyCap = inScene.find((c) => c.lines.flat().some((w) => w.emphasis)) ?? inScene[0];
    const lastW = keyCap?.lines.flat().at(-1);
    const layCard = lay.find((l) => l.card && l.start >= s0 - 0.01);
    const keyT = layCard
      ? Math.min(s1 - 0.05, layCard.end - 0.35, Math.max(layCard.start + 0.6, (layCard.card!.items.at(-1)?.at ?? layCard.start) + 0.6))
      : bt[0]
      ? Math.min(s1 - 0.05, bt[0].start + 0.9)
      : keyCap && lastW
        ? Math.max(s0, Math.min(s1 - 0.05, keyCap.end - 0.3, lastW.start + Math.max(0.08, (lastW.end - lastW.start) * 0.6)))
        : (s0 + s1) / 2;
    const cam = cameraAt(camera, keyT, easeInOut);
    const v = visualAt(keyT);
    return {
      index: i + 1, start: r3(s0), end: r3(s1), keyT: r3(keyT),
      title: layCard ? `${INTENT_LABEL[layCard.intent ?? "neutral"]}: ${layCard.card!.items.map((x) => x.text).join(" · ")}` : bt[0] ? `Жазу артта: ${bt[0].text}` : caps[0] ? caps[0].lines.flat().map((w) => w.text).join(" ").slice(0, 40) : "—",
      onScreenText: caps.map((c) => c.lines.map((l) => l.map((w) => (w.emphasis ? `*${w.text}*` : w.text)).join(" ")).join(" / ")).join(" | "),
      camera: v.kind === "video" ? `зум ×${cam.zoom.toFixed(2)}${camera.some((k) => k.move === "ease" && k.t > s0 && k.t <= s1) ? ", плавный наезд" : ""}, ${v.framing === "contain" ? "видео в рамке + размытый фон" : "лицо в верхней трети"}` : v.kind === "photo" ? "фото, медленный наезд (Ken Burns)" : "графический фон",
      animation: `${st.label}: ${st.enter === "pop" ? "слова выпрыгивают" : st.enter === "rise" ? "слова поднимаются" : st.enter === "slide" ? "слова выезжают" : "плавное появление"}, активное слово — ${st.active === "pill" ? "плашка" : st.active === "color" ? "цвет" : st.active === "scale" ? "увеличение" : "подчёркивание"}${bt.length ? "; крупное слово за головой" : ""}${lay.length ? `; ${lay.map((l) => LAYOUT_LABEL[l.kind] ?? "весь кадр").join(", ")}` : ""}${beats.filter((b) => bFirst(b).start < s1 && bLast(b).end > s0).map((b) => `; мағынасы: ${b.reason}`).join("")}${callouts.filter((c) => c.start < s1 && c.end > s0).map((c) => `; плашка «${c.text}»`).join("")}${ics.length ? `; иконки: ${ics.map((x) => `${x.name} («${x.word}»)`).join(", ")}` : ""}`,
      sfx: fx.length ? fx.map((x) => `${x.kind} ${x.t.toFixed(1)}с`).join(", ") : "—",
      checks: checks.filter((c) => c.at !== null && c.at >= s0 && c.at < s1),
    };
  });

  return {
    schema: 1, projectId: project.id, version, updatedAt: new Date().toISOString(), mode: project.mode,
    format: o.format, platform: o.platform, width: W, height: H, fps, durationSec: r3(duration),
    style: { preset: o.style, colors, captionPosition: o.captionPosition, overrides: o.styleOverrides ?? {}, source: o.styleSource ?? o.style },
    grade: o.grade ?? null,
    voice: { src: voice.prepared, gain: 1 },
    visuals, camera, captions, behindText, callouts, layouts, icons, sfx, widgets, progressBar: o.progressBar, scenes, checks,
    music: o.music ? { src: o.music, gain: 0.2, duck: 0.07, speech: speechSpans(words) } : null,
    beats: beats.map((b) => ({ start: r3(bFirst(b).start), end: r3(bLast(b).end), intent: b.intent, reason: b.reason, source: b.source })),
    transcriptNote: transcript.notes.join(" "),
  };
}
