/** Export formats (section 17 of the spec). Composition rules per format live in src/layout (Phase 5). */
export const FORMATS = {
  "9:16": { width: 1080, height: 1920, label: "Reels / Shorts / Stories / TikTok" },
  "16:9": { width: 1920, height: 1080, label: "YouTube / horizontal" },
  "4:5": { width: 1080, height: 1350, label: "Instagram Feed" },
  "1:1": { width: 1080, height: 1080, label: "Square" },
} as const;
export type FormatId = keyof typeof FORMATS;
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];
