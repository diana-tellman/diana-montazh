/**
 * npm run bench -- [--seconds 30] [--concurrency N]
 * Measures real cloud render speed on a Reels-like workload (synthetic media only).
 */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { probe } from "../src/core/media";
import { classify, ingestMaterials } from "../src/core/ingest";
import { createProject, pathsFor, ROOT } from "../src/core/store";
import { renderMp4 } from "../src/render/renderer";
import { blurFillArgs } from "../src/core/transcode";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);

main(async () => {
  const { opt } = parseArgs();
  const seconds = Number(str(opt.seconds) ?? 30);
  const concurrency = str(opt.concurrency) ? Number(opt.concurrency) : null;
  const tmp = join(ROOT, "out", "bench");
  mkdirSync(tmp, { recursive: true });
  const src = join(tmp, "src.mov");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=1080x1920:rate=30:duration=${seconds}`, "-f", "lavfi", "-i", `sine=f=200:d=${seconds}`,
    "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-tag:v", "hvc1", "-c:a", "aac", src]);
  const id = `bench-${Date.now().toString(36)}`;
  try {
    const t0 = Date.now();
    const p = await ingestMaterials(createProject({ id, mode: "expert-video", language: null }), { files: [await classify(src)], voiceFile: src });
    const video = p.assets.find((a) => a.role === "main-video")!.prepared;
    const fill = video.replace(/\.mp4$/, ".fill.mp4");
    await run("ffmpeg", blurFillArgs(join(pathsFor(id).root, video), join(pathsFor(id).root, fill), 1080, 1920));
    const ingestSec = (Date.now() - t0) / 1000;
    const output = join(tmp, "bench.mp4");
    const t1 = Date.now();
    await renderMp4({
      compositionId: "RenderBenchmark",
      publicDir: pathsFor(id).root,
      inputProps: { video, blurredFill: fill, durationSec: seconds },
      output,
      concurrency,
    });
    const renderSec = (Date.now() - t1) / 1000;
    const r = await probe(output);
    out({
      cpus: cpus().length, seconds, concurrency, ingestSec, renderSec,
      realtimeFactor: Math.round((renderSec / seconds) * 100) / 100,
      estimatedFor60s: Math.round((renderSec / seconds) * 60),
      output: { codec: r.video?.codec, size: `${r.video?.width}x${r.video?.height}`, durationSec: r.durationSec, mb: Math.round(r.sizeBytes / 1e5) / 10 },
    });
  } finally {
    rmSync(pathsFor(id).root, { recursive: true, force: true });
  }
});
