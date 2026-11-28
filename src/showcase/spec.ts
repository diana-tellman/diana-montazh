import { z } from "zod";

/**
 * "Showcase" edit: an expert video with bespoke, word-timed effects that the standard planner does not cover
 * (background replacement, layer reveal, silhouette contour, letter animation behind the person, mini schema,
 * timeline, comment field…). Claude writes projects/<id>/storyboard/showcase.json from the user's brief;
 * the same approval gate applies (sha256 of the file, `npm run showcase -- approve`).
 * Times are seconds on the output timeline (= source timeline); px are 1080×1920 output pixels.
 */
const T = z.number().nonnegative();
const Px = z.number();

export const ZoomKeySchema = z.object({ t: T, zoom: z.number().min(1).max(1.6), ax: z.number(), ay: z.number(), move: z.enum(["cut", "ease"]), dur: z.number().positive().default(0.6) });

export const EffectSchema = z.discriminatedUnion("type", [
  /** Big word between background and person (person cut out on top). open = letters unmask from the centre; rise = letters come up one by one. */
  z.object({ type: z.literal("behind"), start: T, end: T, text: z.string(), y: Px, size: Px, anim: z.enum(["open", "rise"]), color: z.string().optional() }),
  /** Background replaced by a colour: vertical edge sweeps left→right at wipeAt; optionally the colour layer slides right at slideAt to reveal the original background (layers). */
  z.object({ type: z.literal("background"), start: T, end: T, color: z.string(), wipeAt: T, wipeDur: z.number().positive(), slideAt: T.optional(), slideDur: z.number().positive().optional(), slideX: Px.optional(), fadeOut: z.number().default(0.25) }),
  /** White outline of the person's silhouette, drawn around the body starting at `fromDeg` (0 = up, clockwise), held, faded. */
  z.object({ type: z.literal("contour"), start: T, drawDur: z.number().positive(), end: T, width: Px.default(7), fromDeg: z.number().default(300), cx: Px.default(540), cy: Px.default(900) }),
  /** Soft light band passing behind the person once. */
  z.object({ type: z.literal("sweep"), start: T, end: T, dur: z.number().positive() }),
  /** On-screen phrase (also serves as the caption). Words appear at their spoken time; optional underline and icon. */
  z.object({
    type: z.literal("label"), start: T, end: T, y: Px, x: Px.default(478), size: Px.default(64),
    words: z.array(z.object({ text: z.string(), at: T })).min(1),
    underlineWord: z.number().int().optional(), underlineAt: T.optional(),
    icon: z.enum(["layers", "cc", "speaker", "cut"]).optional(), iconAt: T.optional(),
    /** speaker: sound waves start here (one click sound belongs to this frame). */
    wavesAt: T.optional(),
    /** Line split: index of the first word of the 2nd line. */
    breakAt: z.number().int().optional(),
  }),
  /** Small schema of icons joined by a drawn line (Кадр → Т → ▶). */
  z.object({ type: z.literal("schema"), start: T, end: T, y: Px, items: z.array(z.object({ icon: z.enum(["frame", "T", "play"]), label: z.string(), at: T })).min(2).max(4) }),
  /** Mini editing timeline: tracks slide in and stack at their times, then the whole timeline fades at fadeAt. */
  z.object({ type: z.literal("timeline"), start: T, fadeAt: T, end: T, y: Px, tracks: z.array(z.object({ icon: z.enum(["layers", "T", "wave"]), at: T })).min(1).max(4) }),
  /** Accent plate with text. */
  z.object({ type: z.literal("plate"), start: T, end: T, y: Px, text: z.string(), x: Px.default(478) }),
  /** Comment field: opens at start, `typed` is typed from typeAt (one char per `charDur`), CTA line above it. */
  z.object({ type: z.literal("comment"), start: T, end: T, y: Px, typeAt: T, typed: z.string(), charDur: z.number().default(0.07), cta: z.string(), ctaAccent: z.string(), ctaAt: T }),
]);

export const ShowcaseSchema = z.object({
  schema: z.literal(1),
  projectId: z.string(),
  version: z.number().int().positive(),
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.literal(30),
  video: z.string(),
  voice: z.string(),
  matteDir: z.string(),
  /** Source length; after it the last frame is frozen for freezeSec. */
  srcDuration: z.number().positive(),
  freezeSec: z.number().min(0).max(3).default(0),
  lastFrame: z.string().nullable().default(null),
  colors: z.object({ accent: z.string(), dark: z.string(), light: z.string() }),
  fonts: z.object({ display: z.string(), text: z.string() }),
  zoom: z.array(ZoomKeySchema),
  effects: z.array(EffectSchema),
  /** Plain captions (only where no on-screen phrase already says the same). */
  captions: z.array(z.object({ start: T, end: T, text: z.string(), y: Px.default(1330) })),
  sfx: z.array(z.object({ t: T, kind: z.string(), gain: z.number().min(0).max(0.5) })),
  /** Storyboard rows for the user (shot list), written by Claude alongside the effects. */
  shots: z.array(z.object({ start: T, end: T, screen: z.string(), spoken: z.string(), text: z.string(), inside: z.string(), transition: z.string(), keyT: T })),
});

export type Showcase = z.infer<typeof ShowcaseSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type ZoomKey = z.infer<typeof ZoomKeySchema>;

export const showcaseDuration = (s: Showcase) => s.srcDuration + s.freezeSec;

/** Zoom at time t (cut = instant, ease = smooth over dur ending at the key). */
export function zoomAt(keys: ZoomKey[], t: number): { zoom: number; ax: number; ay: number } {
  if (!keys.length) return { zoom: 1, ax: 0.5, ay: 0.4 };
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  let cur = { zoom: 1, ax: sorted[0]!.ax, ay: sorted[0]!.ay };
  for (const k of sorted) {
    if (k.move === "cut") {
      if (t >= k.t) cur = { zoom: k.zoom, ax: k.ax, ay: k.ay };
      continue;
    }
    const s0 = k.t - k.dur;
    if (t >= k.t) cur = { zoom: k.zoom, ax: k.ax, ay: k.ay };
    else if (t > s0) {
      const p = (t - s0) / k.dur;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      return { zoom: cur.zoom + (k.zoom - cur.zoom) * e, ax: cur.ax + (k.ax - cur.ax) * e, ay: cur.ay + (k.ay - cur.ay) * e };
    }
  }
  return cur;
}

/** Plain checks before showing: text inside the Reels safe zone, one main text at a time, times inside the video. */
export function showcaseChecks(s: Showcase): string[] {
  const out: string[] = [];
  const dur = showcaseDuration(s);
  const texts: Array<{ a: number; b: number; what: string }> = [];
  for (const e of s.effects) {
    if (e.end > dur + 0.01) out.push(`${e.type} заканчивается после конца видео (${e.end} > ${dur.toFixed(2)})`);
    if (e.type === "label" || e.type === "plate" || e.type === "comment") texts.push({ a: e.start, b: e.end, what: e.type === "label" ? e.words.map((w) => w.text).join(" ") : e.type === "plate" ? e.text : e.cta });
    if ((e.type === "label" || e.type === "plate") && (e.y < 0.115 * 1920 || e.y > 0.77 * 1920)) out.push(`«${e.type}» вне безопасной зоны по высоте (y=${e.y})`);
  }
  for (const c of s.captions) texts.push({ a: c.start, b: c.end, what: c.text });
  texts.sort((x, y) => x.a - y.a);
  for (let i = 1; i < texts.length; i++) if (texts[i]!.a < texts[i - 1]!.b - 0.02) out.push(`Два текста одновременно: «${texts[i - 1]!.what}» и «${texts[i]!.what}» около ${texts[i]!.a.toFixed(2)} с`);
  return out;
}
