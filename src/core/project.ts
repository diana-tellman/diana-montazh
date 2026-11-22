import { z } from "zod";

/**
 * The three production modes. All of them share one pipeline:
 * ANALYSIS → STORYBOARD → APPROVAL → RENDER → COVER → DELIVERY.
 */
export const ModeSchema = z.enum([
  /** MODE 1: user's own talking video. Original voice is kept. */
  "expert-video",
  /** MODE 2: script/text only. Narration comes from TTS or an uploaded voiceover. */
  "text-to-video",
  /** MODE 3: user's own audio recording, no video. Original voice is kept. */
  "audio-to-video",
]);
export type Mode = z.infer<typeof ModeSchema>;

export const StatusSchema = z.enum([
  "created",
  "ingested",
  "analyzed",
  "storyboard_draft",
  "approved",
  "voiced",
  "rendered",
  "cover_done",
  "qc_passed",
  "delivered",
]);
export type Status = z.infer<typeof StatusSchema>;

export const MediaInfoSchema = z.object({
  path: z.string(),
  kind: z.enum(["video", "audio", "image", "unknown"]),
  container: z.string(),
  durationSec: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  video: z
    .object({
      codec: z.string(),
      /** Display size, i.e. after applying rotation metadata. */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      codedWidth: z.number().int().positive(),
      codedHeight: z.number().int().positive(),
      rotation: z.number(),
      fps: z.number().positive(),
      variableFrameRate: z.boolean(),
      orientation: z.enum(["vertical", "horizontal", "square"]),
      aspect: z.string(),
      pixFmt: z.string(),
      bitDepth: z.number().int(),
      colorTransfer: z.string(),
      colorPrimaries: z.string(),
      colorSpace: z.string(),
      hdr: z.enum(["sdr", "hlg", "pq"]),
    })
    .nullable(),
  audio: z
    .object({
      codec: z.string(),
      sampleRate: z.number().int(),
      channels: z.number().int(),
    })
    .nullable(),
});
export type MediaInfo = z.infer<typeof MediaInfoSchema>;

export const VoiceSourceSchema = z.discriminatedUnion("type", [
  /** Original voice from the user's own video/audio (MODE 1 and 3). */
  z.object({ type: z.literal("original") }),
  /** A ready-made voiceover file the user uploaded (MODE 2). */
  z.object({ type: z.literal("uploaded"), file: z.string() }),
  /** Synthetic narrator voice from a stock TTS model (MODE 2). No cloning. */
  z.object({
    type: z.literal("tts"),
    provider: z.enum(["piper", "espeak-draft"]),
    voice: z.string(),
    language: z.enum(["kk", "ru", "en"]),
  }),
]);
export type VoiceSource = z.infer<typeof VoiceSourceSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  createdAt: z.string(),
  updatedAt: z.string(),
  mode: ModeSchema,
  status: StatusSchema,
  language: z.enum(["kk", "ru", "en"]).nullable(),
  source: MediaInfoSchema.nullable(),
  /** Raw script/text for MODE 2 (or a reference script for MODE 1/3). */
  scriptFile: z.string().nullable(),
  voice: VoiceSourceSchema,
  /**
   * Replacing a person's original voice with a synthetic one is only allowed
   * when the user explicitly agreed. Voice cloning is never supported.
   */
  voiceReplacementConsent: z.boolean(),
  history: z.array(z.object({ at: z.string(), status: StatusSchema, note: z.string() })),
});
export type Project = z.infer<typeof ProjectSchema>;
