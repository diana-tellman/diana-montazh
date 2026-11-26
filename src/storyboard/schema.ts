import { z } from "zod";
import { ColorsSchema, StyleOverridesSchema, StylePresetSchema } from "../design/styles";

const Sec = z.number().nonnegative();

/** One caption word with timing (seconds on the output timeline). */
export const CapWordSchema = z.object({ text: z.string(), start: Sec, end: Sec, emphasis: z.boolean() });

export const CaptionSchema = z.object({
  id: z.string(),
  start: Sec,
  end: Sec,
  /** 1–2 lines of words. */
  lines: z.array(z.array(CapWordSchema)).min(1).max(3),
  /** Top of the caption block, normalised 0..1 of frame height. */
  y: z.number(),
  /** Font scale relative to the style size (layout may shrink, never below 0.72). */
  scale: z.number().min(0.5).max(1.6),
});

/** Visual track segment: the user's video, a photo, or a generated graphic background. */
export const VisualSchema = z.object({
  id: z.string(),
  start: Sec,
  end: Sec,
  kind: z.enum(["video", "photo", "graphic"]),
  /** Project-relative path (video proxy / prepared photo). */
  src: z.string().nullable(),
  /** Offset inside the source video (seconds). */
  srcStart: Sec,
  srcW: z.number().positive(),
  srcH: z.number().positive(),
  framing: z.enum(["cover", "contain"]),
  /** ffmpeg-baked blurred background (contain framing). */
  fill: z.string().nullable(),
});

/** Camera keyframes: zoom + anchor (normalised source coords). Between keys: hold or eased push. */
export const CameraKeySchema = z.object({
  t: Sec,
  zoom: z.number().min(1).max(1.6),
  ax: z.number(),
  ay: z.number(),
  /** "cut" = jump at t (jump-cut zoom); "ease" = smooth move from the previous key ending at t. */
  move: z.enum(["cut", "ease"]),
  /** Duration of an "ease" move that ends at t (seconds). */
  dur: z.number().positive(),
});

export const BehindTextSchema = z.object({
  id: z.string(),
  start: Sec,
  end: Sec,
  text: z.string(),
  /** Vertical centre, normalised. Head covers the lower part of the letters. */
  y: z.number(),
  /** Font size as fraction of frame width. */
  size: z.number(),
  /** Folder (project-relative) of RGBA person cut-out frames; filled at render time. */
  matteDir: z.string().nullable(),
  /** Output time of the first matte frame (shared matte sequences). */
  matteStart: z.number().default(0),
});

export const CalloutSchema = z.object({
  id: z.string(),
  start: Sec,
  end: Sec,
  text: z.string(),
  kind: z.enum(["glass", "tag", "cta"]),
  y: z.number(),
});

/** Screen layout over a time range. Default (no entry) = full frame. */
export const LayoutSchema = z.object({
  id: z.string(),
  start: Sec,
  end: Sec,
  /** full = person fills the frame; circle = person in a round frame over a background;
   *  split = screen split in two: top = secondary visual, bottom = person. */
  kind: z.enum(["full", "circle", "split", "pip"]),
  /** Project-relative photo/video for the other part (null = brand graphic background). */
  secondary: z.string().nullable(),
  secondaryKind: z.enum(["photo", "video", "graphic"]),
  secondaryW: z.number().positive(),
  secondaryH: z.number().positive(),
});

/** Animated line icon tied to a word in the speech. */
export const IconSchema = z.object({
  id: z.string(),
  start: Sec,
  end: Sec,
  name: z.string(),
  /** Centre, normalised. */
  x: z.number(),
  y: z.number(),
  /** Diameter as fraction of frame width. */
  size: z.number(),
  word: z.string(),
});

const T = z.number().nonnegative();
const MatteRef = { matteDir: z.string().nullable().default(null), matteStart: z.number().default(0) };

/**
 * Motion-design beats: one meaningful visual device per speech block.
 * - cutout: person cut out over a brand background (background replacement), with optional
 *   before/after compare and a white outline drawn around the person.
 * - headline: large kinetic typography (mask reveal, underline draw, highlight sweep), optionally
 *   behind the person (depth masking); hideWords removes the same words from captions.
 * - diagram: icon nodes connected by drawn arrows (explainer graphics).
 * - punch: light sweep overlay synced with a camera punch (visual + sound effect demo).
 * - shapeWipe: brand shape transition between compositions.
 */
const ANIM = z.enum(["mask", "stagger", "word", "script", "fade", "blur", "scale", "tracking", "slideLeft", "slideRight", "typewriter"]);
const EXIT = z.enum(["up", "down", "fade", "blur", "left", "right", "none"]);
const COLOR = z.enum(["milk", "pink", "burgundy", "graphite", "accent", "text"]);

export const BeatSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cutout"), id: z.string(), start: T, end: T,
    bg: z.enum(["brand", "texture"]).default("brand"),
    wipeIn: z.enum(["up", "circle", "none"]).default("up"), wipeOut: z.enum(["down", "circle", "none"]).default("down"),
    compare: z.tuple([T, T]).nullable().default(null),
    outline: z.tuple([T, T]).nullable().default(null),
    ...MatteRef,
  }),
  /**
   * Editorial typographic poster. Lines in three roles (bold sans / elegant serif / italic / script).
   * Items without `y` are laid out automatically by the stack engine (measured in the browser):
   * consistent leading, script/italic accents overlap the line above, everything fits the safe width.
   */
  z.object({
    kind: z.literal("poster"), id: z.string(), start: T, end: T,
    bg: z.enum(["none", "shade-top", "shade-bottom", "mono", "texture", "blur-dim"]).default("none"),
    behind: z.boolean().default(false),
    hideWords: z.boolean().default(true),
    monoSrc: z.string().nullable().default(null),
    /** Stack layout: vertical anchor (centre of the block), alignment, max width (fraction of W). */
    anchorY: z.number().default(0.2),
    align: z.enum(["center", "left", "right"]).default("center"),
    maxWidth: z.number().default(0.74),
    exit: EXIT.default("up"),
    /** Slow drift while the poster holds (subtle scale). */
    drift: z.boolean().default(true),
    items: z.array(z.object({
      text: z.string(),
      role: z.enum(["sans", "serif", "italic", "script", "label"]),
      size: z.number(),
      /** Absolute vertical centre (fraction of H). Omit to use the stack engine. */
      y: z.number().optional(),
      x: z.number().optional(),
      /** Extra horizontal offset inside the stack (fraction of W). */
      dx: z.number().default(0),
      color: COLOR.default("milk"),
      at: T,
      anim: ANIM.default("mask"),
      tracking: z.number().optional(),
      rotate: z.number().default(0),
      move: z.object({ at: T, dy: z.number(), scale: z.number().default(1) }).nullable().default(null),
      until: T.nullable().default(null),
      front: z.boolean().default(false),
      /** Per-word reveal times (filled from the transcript for anim "word"). */
      wordTimes: z.array(T).optional(),
      /** Underline drawn under this item after it appears. */
      underline: z.boolean().default(false),
    })).min(1),
    ...MatteRef,
  }),
  /** Plates: glass, solid, outline, bracket, tag, lower third, big number, CTA button, quote. */
  z.object({
    kind: z.literal("plate"), id: z.string(), start: T, end: T,
    variant: z.enum(["glass", "solid", "outline", "bracket", "tag", "lowerThird", "number", "cta", "quote"]),
    text: z.string(), sub: z.string().nullable().default(null),
    x: z.number().default(0.5), y: z.number(), align: z.enum(["center", "left", "right"]).default("center"),
    size: z.number().default(0.05), icon: z.string().nullable().default(null),
    anim: ANIM.default("blur"), exit: EXIT.default("fade"),
  }),
  z.object({
    kind: z.literal("diagram"), id: z.string(), start: T, end: T,
    nodes: z.array(z.object({ icon: z.string(), at: T, label: z.string().optional() })).min(2), y: z.number(),
  }),
  z.object({ kind: z.literal("punch"), id: z.string(), start: T, end: T, mono: z.boolean().default(false), monoSrc: z.string().nullable().default(null) }),
  /** Transitions: brand shape, typographic panel, white flash, whip streak, zoom blur. Drawn above everything. */
  z.object({
    kind: z.literal("transition"), id: z.string(), start: T, end: T,
    style: z.enum(["shape", "type", "flash", "whip", "zoom"]), text: z.string().nullable().default(null),
  }),
]);
export type Beat = z.infer<typeof BeatSchema>;

export const SfxSchema = z.object({
  t: Sec,
  kind: z.enum(["pop", "whoosh", "tick", "soft", "riser", "impact", "swipe", "click", "sweep", "tonal", "trace", "reveal", "type", "bell"]),
  /** Linear gain (0..1) — kept well under the voice. */
  gain: z.number().min(0).max(1),
  reason: z.string(),
});

export const CheckSchema = z.object({ level: z.enum(["ok", "warn", "error"]), code: z.string(), message: z.string(), at: Sec.nullable() });

export const SceneSchema = z.object({
  index: z.number().int().positive(),
  start: Sec,
  end: Sec,
  /** Representative frame time for the storyboard image. */
  keyT: Sec,
  title: z.string(),
  onScreenText: z.string(),
  camera: z.string(),
  animation: z.string(),
  sfx: z.string(),
  checks: z.array(CheckSchema),
});

export const StoryboardSchema = z.object({
  schema: z.literal(1),
  projectId: z.string(),
  /** Increases on every change. Approval is bound to version + hash. */
  version: z.number().int().positive(),
  updatedAt: z.string(),
  mode: z.enum(["expert-video", "voice-over-visuals"]),
  format: z.enum(["9:16", "16:9", "4:5", "1:1"]),
  platform: z.enum(["reels", "stories", "shorts", "tiktok", "feed", "square", "youtube"]),
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number(),
  durationSec: z.number().positive(),
  style: z.object({
    preset: StylePresetSchema,
    colors: ColorsSchema,
    captionPosition: z.enum(["auto", "top", "middle", "lower", "bottom"]),
    /** Overrides of the preset (reference video / explicit wishes). */
    overrides: StyleOverridesSchema,
    /** Short human description of where the style comes from (shown in the storyboard). */
    source: z.string(),
  }),
  /** Colour grade applied to the person's video (baked by ffmpeg), or null. */
  grade: z.object({ lut: z.string(), strength: z.number(), from: z.string(), filter: z.string().optional() }).nullable(),
  voice: z.object({ src: z.string(), gain: z.number() }),
  visuals: z.array(VisualSchema),
  camera: z.array(CameraKeySchema),
  captions: z.array(CaptionSchema),
  behindText: z.array(BehindTextSchema),
  callouts: z.array(CalloutSchema),
  layouts: z.array(LayoutSchema),
  /** Authored motion-design beats (Claude, per meaning of the speech). */
  beats: z.array(BeatSchema).default([]),
  icons: z.array(IconSchema),
  sfx: z.array(SfxSchema),
  progressBar: z.boolean(),
  scenes: z.array(SceneSchema),
  checks: z.array(CheckSchema),
  /** Transcript quality note shown to the user. */
  transcriptNote: z.string(),
});

export type CapWord = z.infer<typeof CapWordSchema>;
export type Caption = z.infer<typeof CaptionSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type CameraKey = z.infer<typeof CameraKeySchema>;
export type BehindText = z.infer<typeof BehindTextSchema>;
export type Callout = z.infer<typeof CalloutSchema>;
export type Sfx = z.infer<typeof SfxSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Icon = z.infer<typeof IconSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Storyboard = z.infer<typeof StoryboardSchema>;

/** Camera state at time t (shared by planner and composition). */
export function cameraAt(keys: CameraKey[], t: number, easeFn: (x: number) => number) {
  if (!keys.length) return { zoom: 1, ax: 0.5, ay: 0.4 };
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1]!.t <= t) i++;
  const k = keys[i]!;
  const next = keys[i + 1];
  if (next && next.move === "ease" && t > next.t - next.dur) {
    const p = easeFn(Math.min(1, Math.max(0, (t - (next.t - next.dur)) / next.dur)));
    return { zoom: k.zoom + (next.zoom - k.zoom) * p, ax: k.ax + (next.ax - k.ax) * p, ay: k.ay + (next.ay - k.ay) * p };
  }
  return { zoom: k.zoom, ax: k.ax, ay: k.ay };
}

/** Layout kind active at time t (full when none). */
export function layoutAt(layouts: Layout[], t: number): Layout["kind"] {
  return layouts.find((l) => t >= l.start && t < l.end)?.kind ?? "full";
}
