import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { join } from "node:path";
import { ROOT } from "../core/store";
import { findBrowserExecutable } from "./browser";

export async function bundleFor(publicDir: string): Promise<string> {
  return bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir });
}

/** Render several stills of one composition with a single browser instance. */
export async function renderStills(opts: {
  serveUrl: string;
  compositionId: string;
  jobs: Array<{ frame: number; inputProps: Record<string, unknown>; output: string }>;
  scale?: number;
  format?: "jpeg" | "png";
}): Promise<void> {
  const browserExecutable = findBrowserExecutable();
  const browser = await openBrowser("chrome", { browserExecutable, chromiumOptions: { gl: "swangle" } });
  try {
    for (const j of opts.jobs) {
      const composition = await selectComposition({ serveUrl: opts.serveUrl, id: opts.compositionId, inputProps: j.inputProps, puppeteerInstance: browser });
      await renderStill({
        serveUrl: opts.serveUrl, composition, frame: Math.min(j.frame, composition.durationInFrames - 1), inputProps: j.inputProps,
        output: j.output, imageFormat: opts.format ?? "jpeg", ...((opts.format ?? "jpeg") === "jpeg" ? { jpegQuality: 85 } : {}), scale: opts.scale ?? 1, puppeteerInstance: browser,
      });
    }
  } finally {
    await browser.close({ silent: true });
  }
}
