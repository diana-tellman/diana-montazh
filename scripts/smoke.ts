/**
 * npm run smoke — end-to-end check of the core engine on SYNTHETIC media (no user data):
 *  1. builds a 4 s vertical 10-bit HLG HEVC clip with tone (like an iPhone recording),
 *  2. creates an expert-video project (mode auto-detected), ingests it,
 *  3. verifies the proxy (H.264, yuv420p, BT.709, CFR 30 fps, SDR),
 *  4. renders 2 s through Remotion and verifies the MP4.
 */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { probe } from "../src/core/media";
import { ingestMedia } from "../src/core/ingest";
import { createProject, pathsFor, ROOT } from "../src/core/store";
import { renderMp4 } from "../src/render/renderer";
import { main, out } from "./_cli";

const run = promisify(execFile);

main(async () => {
  const tmp = join(ROOT, "out", "smoke");
  mkdirSync(tmp, { recursive: true });
  const src = join(tmp, "iphone-like.mov");
  await run("ffmpeg", [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=4",
    "-vf", "format=yuv420p10le",
    "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
    "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
    "-tag:v", "hvc1", "-c:a", "aac", "-shortest", src,
  ]);

  const id = `smoke-${Date.now().toString(36)}`;
  try {
    let project = createProject({ id, mode: "expert-video", language: "kk" });
    const { report } = await ingestMedia(project, src);
    const proxy = await probe(report.proxy!);
    const checks = {
      sourceHdr: report.source.video?.hdr === "hlg",
      proxyH264: proxy.video?.codec === "h264",
      proxySdr: proxy.video?.hdr === "sdr" && proxy.video.colorPrimaries === "bt709",
      proxy8bit: proxy.video?.pixFmt === "yuv420p",
      proxy30fps: proxy.video?.fps === 30 && !proxy.video.variableFrameRate,
      voiceEnhanced: report.enhancedVoice !== null,
    };
    const output = join(tmp, "render.mp4");
    await renderMp4({
      compositionId: "Main-9x16",
      publicDir: pathsFor(id).root,
      inputProps: { video: "work/proxy.mp4", audio: "work/voice-enhanced.wav", durationSec: 4, fps: 30, background: "#141414" },
      output,
      frameRange: [0, 59],
    });
    const r = await probe(output);
    const renderChecks = {
      renderH264: r.video?.codec === "h264",
      render1080x1920: r.video?.width === 1080 && r.video.height === 1920,
      renderAac: r.audio?.codec === "aac",
      renderDuration2s: Math.abs(r.durationSec - 2) < 0.15,
    };
    const all = { ...checks, ...renderChecks };
    const ok = Object.values(all).every(Boolean);
    out({ ok, checks: all, notes: report.notes, output });
    if (!ok) process.exit(1);
  } finally {
    rmSync(pathsFor(id).root, { recursive: true, force: true });
  }
});
