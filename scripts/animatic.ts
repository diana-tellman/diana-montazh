/**
 * npm run animatic -- <id> [--scale 0.5]
 * Light MOTION + SOUND preview of the CURRENT storyboard (540×960, watermark "ЭСКИЗ"), for the phone,
 * before approval: the student sees how the speaker moves into a window, how the explainer appears,
 * and hears the effects/music under the voice. Not a final video: the final render stays gated by approval.
 * Output: storyboard/animatic.mp4 (small, fast-start).
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathsFor } from "../src/core/store";
import { renderMp4 } from "../src/render/renderer";
import { loadStoryboard, previewStamp, storyboardHash } from "../src/storyboard/store";
import { existsSync, readFileSync } from "node:fs";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);

main(async () => {
  const { pos, opt } = parseArgs();
  const id = pos[0] ?? "";
  const p = pathsFor(id);
  const sb = loadStoryboard(id);
  const stamp = existsSync(previewStamp(id)) ? (JSON.parse(readFileSync(previewStamp(id), "utf8")) as { hash: string }) : null;
  if (!stamp || stamp.hash !== storyboardHash(sb)) throw new Error("Сначала npm run storyboard -- <id> (аниматик показывает ту же версию, что и сториборд).");
  const scale = Number(str(opt.scale) ?? 0.5);
  const raw = join(p.work, "animatic-raw.mp4");
  const t0 = Date.now();
  let last = -1;
  // Text behind the head needs person cut-outs (slow) — the animatic shows it without the cut-out.
  await renderMp4({
    compositionId: "Edit", publicDir: p.root, inputProps: { storyboard: sb, guides: null, useMattes: false }, output: raw, scale,
    onProgress: (x) => {
      const pc = Math.floor(x * 10);
      if (pc !== last) (last = pc), console.error(`Аниматик: ${pc * 10}%`);
    },
  });
  const file = join(p.storyboard, "animatic.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "drawtext=text='ЭСКИЗ v" + sb.version + "':fontcolor=white@0.55:fontsize=h/28:x=w-tw-20:y=20:box=1:boxcolor=black@0.35:boxborderw=8", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", file]).catch(async () => {
    // drawtext needs a font; without it, ship the preview unmarked.
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", file]);
  });
  out({ id, version: sb.version, animatic: file, sizeMb: Math.round(statSync(file).size / 1e5) / 10, seconds: Math.round((Date.now() - t0) / 1000) });
});
