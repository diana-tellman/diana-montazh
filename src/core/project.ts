import { z } from "zod";

/**
 * Production modes. The narration is ALWAYS the user's own voice —
 * the system never generates or replaces a voice.
 * All modes share: ANALYSIS → STORYBOARD → APPROVAL → RENDER → COVER → QC → DELIVERY.
 */
export const ModeSchema = z.enum([
  /** User's own talking video(s). Voice = the video's own speech. */
  "expert-video",
  /** User's own voice recording (MP3/M4A/WAV…) + optional photos / silent clips, or pure motion graphics. */
  "voice-over-visuals",
]);
export type Mode = z.infer<typeof ModeSchema>;

export const StatusSchema = z.enum([
  "created",
  "ingested",
  "analyzed",
  "storyboard_draft",
  "approved",
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

/** One prepared asset of the project (paths are relative to the project folder). */
export const AssetSchema = z.object({
  id: z.string(),
  role: z.enum(["main-video", "broll-video", "photo", "voice"]),
  original: z.string(),
  /** Editing-ready file: proxy.mp4 for video, normalized JPEG/PNG for photos, enhanced WAV for voice. */
  prepared: z.string(),
  info: MediaInfoSchema,
  notes: z.array(z.string()),
});
export type Asset = z.infer<typeof AssetSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  createdAt: z.string(),
  updatedAt: z.string(),
  mode: ModeSchema,
  status: StatusSchema,
  /** Speech language for recognition; null = auto-detect. */
  language: z.enum(["kk", "ru", "en"]).nullable(),
  /** The user's style wishes, verbatim. */
  styleRequest: z.string(),
  assets: z.array(AssetSchema),
  /** Asset id of the narration master (the user's own voice). */
  voiceAssetId: z.string().nullable(),
  /** Optional script text (project-relative path): exact words for captions, timing comes from the audio. */
  scriptFile: z.string().nullable(),
  history: z.array(z.object({ at: z.string(), status: StatusSchema, note: z.string() })),
});
export type Project = z.infer<typeof ProjectSchema>;
