import { z } from "zod";

export const WordSchema = z.object({ text: z.string(), startMs: z.number(), endMs: z.number() });
export const SegmentSchema = z.object({ startMs: z.number(), endMs: z.number(), text: z.string(), words: z.array(WordSchema) });

/**
 * Transcript of the user's own voice. Honest timing labels:
 * - segment timing "measured": phrase boundaries come from voice-activity detection on the real audio;
 * - word timing "estimated": words are distributed inside a phrase by length (no per-word acoustic alignment).
 */
export const TranscriptSchema = z.object({
  version: z.literal(1),
  source: z.enum(["asr", "import", "script-aligned"]),
  model: z.string().nullable(),
  language: z.string().nullable(),
  durationMs: z.number(),
  timing: z.object({ segments: z.enum(["measured", "imported"]), words: z.enum(["estimated", "imported"]) }),
  /** True when the text must be checked by the user (always for ASR; Kazakh ASR is less accurate). */
  needsReview: z.boolean(),
  notes: z.array(z.string()),
  segments: z.array(SegmentSchema),
});
export type Word = z.infer<typeof WordSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;

export function splitWords(text: string): string[] {
  return text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

/** Distribute words inside [startMs, endMs] proportionally to their length (+ pause weight after punctuation). */
export function estimateWords(text: string, startMs: number, endMs: number): Word[] {
  const words = splitWords(text);
  const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,!?;:…]$/.test(w) ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, endMs - startMs);
  let t = startMs;
  return words.map((w, i) => {
    const d = (span * (weights[i] ?? 0)) / total;
    const item = { text: w, startMs: Math.round(t), endMs: Math.round(t + d) };
    t += d;
    return item;
  });
}

/** Convert to the caption format used by Remotion (`@remotion/captions`). */
export function toRemotionCaptions(t: Transcript) {
  return t.segments.flatMap((s) =>
    s.words.map((w, i) => ({
      text: (i === 0 ? "" : " ") + w.text,
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: Math.round((w.startMs + w.endMs) / 2),
      confidence: null,
    })),
  );
}
