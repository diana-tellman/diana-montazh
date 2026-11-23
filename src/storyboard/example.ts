import { STYLES } from "../design/styles";
import type { Storyboard } from "./schema";

/** Minimal valid storyboard used as Studio default props (graphic background, two captions). */
export const EXAMPLE_STORYBOARD: Storyboard = {
  schema: 1, projectId: "example", version: 1, updatedAt: "2026-01-01T00:00:00.000Z", mode: "voice-over-visuals",
  format: "9:16", platform: "reels", width: 1080, height: 1920, fps: 30, durationSec: 4,
  style: { preset: "brand", colors: STYLES.brand.colors, captionPosition: "auto" },
  voice: { src: "work/voice-enhanced.wav", gain: 1 },
  visuals: [{ id: "g1", start: 0, end: 4, kind: "graphic", src: null, srcStart: 0, srcW: 1080, srcH: 1920, framing: "cover", fill: null }],
  camera: [{ t: 0, zoom: 1, ax: 0.5, ay: 0.45, move: "cut", dur: 0.9 }],
  captions: [
    { id: "c1", start: 0.2, end: 2, y: 0.6, scale: 1, lines: [[{ text: "Сәлеметсіз", start: 0.2, end: 0.9, emphasis: false }, { text: "бе!", start: 0.9, end: 1.4, emphasis: false }]] },
    { id: "c2", start: 2, end: 4, y: 0.6, scale: 1, lines: [[{ text: "Қысқа", start: 2, end: 2.6, emphasis: false }, { text: "видео", start: 2.6, end: 3.2, emphasis: true }]] },
  ],
  behindText: [], callouts: [], layouts: [], icons: [], sfx: [], progressBar: true, scenes: [], checks: [], transcriptNote: "",
};
