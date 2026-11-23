import { z } from "zod";
import { ColorsSchema, StylePresetSchema } from "../design/styles";

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
  kind: z.enum(["full", "circle", "split"]),
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

export const SfxSchema = z.object({
  t: Sec,
  kind: z.enum(["pop", "whoosh", "tick", "soft", "riser"]),
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
  style: z.object({ preset: StylePresetSchema, colors: ColorsSchema, captionPosition: z.enum(["auto", "top", "middle", "bottom"]) }),
  voice: z.object({ src: z.string(), gain: z.number() }),
  visuals: z.array(VisualSchema),
  camera: z.array(CameraKeySchema),
  captions: z.array(CaptionSchema),
  behindText: z.array(BehindTextSchema),
  callouts: z.array(CalloutSchema),
  layouts: z.array(LayoutSchema),
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
