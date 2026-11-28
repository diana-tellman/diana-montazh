import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathsFor } from "../core/store";
import type { Storyboard } from "../storyboard/schema";
import { ShowcaseSchema, showcaseDuration, type Showcase } from "./spec";

export const showcaseHash = (s: Showcase) => createHash("sha256").update(JSON.stringify({ ...s, version: 0 })).digest("hex");

/** The project's showcase edit, if it is rendered/approved through `npm run showcase` (null = standard storyboard). */
export function loadShowcase(id: string): Showcase | null {
  const f = join(pathsFor(id).storyboard, "showcase.json");
  return existsSync(f) ? ShowcaseSchema.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
}

export function readShowcaseApproval(id: string): { hash: string; version: number } | null {
  const f = join(pathsFor(id).storyboard, "showcase-approval.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { hash: string; version: number } | null) : null;
}

/** Minimal Storyboard view of a showcase edit, for cover and QC (same output checks). */
export function showcaseAsStoryboard(s: Showcase): Storyboard {
  return {
    schema: 1, projectId: s.projectId, version: s.version, updatedAt: "", mode: "expert-video", format: "9:16", platform: "reels",
    width: s.width, height: s.height, fps: s.fps, durationSec: showcaseDuration(s),
    style: { preset: "brand", colors: { text: "#F7F5F2", accent: "#8D263E", onAccent: "#FFFFFF" }, captionPosition: "auto", overrides: {}, source: "showcase" },
    grade: null, voice: { src: s.voice, gain: 1 },
    visuals: [{ id: "v1", start: 0, end: s.srcDuration, kind: "video", src: s.video, srcStart: 0, srcW: s.width, srcH: s.height, framing: "cover", fill: null }],
    camera: [], captions: [], behindText: [], callouts: [], layouts: [], icons: [], sfx: [], progressBar: false, scenes: [], checks: [], transcriptNote: "",
  } as unknown as Storyboard;
}
