import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { join } from "node:path";
import { ROOT } from "../core/store";
import { findBrowserExecutable } from "./browser";

export type RenderJob = {
  compositionId: string;
  inputProps: Record<string, unknown>;
  /** Folder whose files are reachable via staticFile() — the project folder. */
  publicDir: string;
  output: string;
  /** Optional frame range for smoke tests / previews. */
  frameRange?: [number, number];
  scale?: number;
  onProgress?: (p: number) => void;
};

/** Low-level Remotion render to H.264/AAC MP4. The approval gate is enforced one level up (Phase 7–8). */
export async function renderMp4(job: RenderJob): Promise<string> {
  const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: job.publicDir });
  const browserExecutable = findBrowserExecutable();
  const composition = await selectComposition({ serveUrl, id: job.compositionId, inputProps: job.inputProps, browserExecutable });
  await renderMedia({
    serveUrl,
    composition,
    inputProps: job.inputProps,
    codec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    crf: 18,
    colorSpace: "bt709",
    outputLocation: job.output,
    browserExecutable,
    frameRange: job.frameRange ?? null,
    scale: job.scale ?? 1,
    chromiumOptions: { gl: "swangle" },
    onProgress: ({ progress }) => job.onProgress?.(progress),
  });
  return job.output;
}
