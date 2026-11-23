/**
 * npm run smoke — end-to-end check of the core engine on SYNTHETIC media (no user data).
 *  A) expert-video: vertical 10-bit HLG HEVC clip with voice (like an iPhone recording)
 *     → mode detection → proxy (H.264 SDR BT.709 CFR) → Remotion render 2 s → MP4 checks.
 *  B) voice-over-visuals: M4A voice + JPEG photo with EXIF rotation
 *     → mode detection → oriented photo → enhanced voice → speech recognition (tiny model).
 * Speech is synthesised with espeak-ng when available (test fixture only, never used in videos).
 */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { detectMode } from "../src/core/modes";
import { probe } from "../src/core/media";
import { classify, ingestMaterials } from "../src/core/ingest";
import { createProject, MODELS_DIR, pathsFor, ROOT } from "../src/core/store";
import { renderMp4 } from "../src/render/renderer";
import { transcribe } from "../src/speech/transcribe";
import { main, out } from "./_cli";

const run = promisify(execFile);

async function speechFixture(dest: string): Promise<boolean> {
  try {
    await run("espeak-ng", ["-v", "en-us", "-s", "150", "-w", dest, "Hello! Today I will show you how to edit a short video for Instagram. It is very easy."]);
    return true;
  } catch {
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=6", "-af", "volume=0.5", dest]);
    return false;
  }
}

main(async () => {
  const tmp = join(ROOT, "out", "smoke");
  mkdirSync(tmp, { recursive: true });
  const speechWav = join(tmp, "speech.wav");
  const realSpeech = await speechFixture(speechWav);
  const checks: Record<string, boolean> = {};
  const ids: string[] = [];

  try {
    // ---------- A) expert-video ----------
    const mov = join(tmp, "iphone-like.mov");
    await run("ffmpeg", [
      "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=5", "-i", speechWav,
      "-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast",
      "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
      "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc", "-tag:v", "hvc1",
      "-c:a", "aac", "-t", "5", mov,
    ]);
    const cA = await classify(mov);
    const dA = detectMode({ videos: [{ name: "iphone-like.mov", speechLikely: cA.speechLikely }], audios: [], photos: [], hasScript: false });
    checks.A_modeExpert = dA.kind === "decided" && dA.mode === "expert-video";
    const idA = `smoke-a-${Date.now().toString(36)}`;
    ids.push(idA);
    const pA = await ingestMaterials(createProject({ id: idA, mode: "expert-video", language: "en" }), { files: [cA], voiceFile: mov });
    const video = pA.assets.find((a) => a.role === "main-video")!;
    const proxy = await probe(join(pathsFor(idA).root, video.prepared));
    checks.A_sourceHdr = cA.info.video?.hdr === "hlg";
    checks.A_proxyH264Sdr = proxy.video?.codec === "h264" && proxy.video.hdr === "sdr" && proxy.video.pixFmt === "yuv420p";
    checks.A_proxy30fps = proxy.video?.fps === 30 && !proxy.video.variableFrameRate;
    checks.A_voiceAsset = pA.voiceAssetId === "voice";
    const output = join(tmp, "render.mp4");
    await renderMp4({
      compositionId: "Main-9x16",
      publicDir: pathsFor(idA).root,
      inputProps: { video: video.prepared, audio: pA.assets.find((a) => a.id === "voice")!.prepared, durationSec: 5, fps: 30, background: "#141414" },
      output,
      frameRange: [0, 59],
    });
    const r = await probe(output);
    checks.A_renderMp4 = r.video?.codec === "h264" && r.video.width === 1080 && r.video.height === 1920 && r.audio?.codec === "aac" && Math.abs(r.durationSec - 2) < 0.15;

    // ---------- B) voice-over-visuals ----------
    const m4a = join(tmp, "voice.m4a");
    await run("ffmpeg", ["-v", "error", "-y", "-i", speechWav, "-c:a", "aac", "-b:a", "128k", m4a]);
    const jpg = join(tmp, "photo-rotated.jpg");
    // Landscape pixels + EXIF orientation 6 → must display as portrait.
    await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#6B1732" } }).jpeg().withMetadata({ orientation: 6 }).toFile(jpg);
    const files = [await classify(m4a), await classify(jpg)];
    const dB = detectMode({ videos: [], audios: ["voice.m4a"], photos: ["photo-rotated.jpg"], hasScript: false });
    checks.B_modeVoiceOver = dB.kind === "decided" && dB.mode === "voice-over-visuals";
    const idB = `smoke-b-${Date.now().toString(36)}`;
    ids.push(idB);
    const pB = await ingestMaterials(createProject({ id: idB, mode: "voice-over-visuals", language: "en" }), { files, voiceFile: m4a });
    const photo = pB.assets.find((a) => a.role === "photo")!;
    checks.B_photoOriented = photo.info.video?.width === 1200 && photo.info.video.height === 1600;
    checks.B_voiceEnhanced = pB.voiceAssetId === "voice";

    let transcript: string | null = null;
    if (realSpeech) {
      const t = await transcribe({ wav16k: join(pathsFor(idB).work, "voice-16k.wav"), modelsRoot: MODELS_DIR, language: "en", model: "whisper-tiny" });
      transcript = t.segments.map((s) => s.text).join(" ");
      checks.B_transcribed = /video/i.test(transcript) && t.segments.every((s) => s.words.length > 0 && s.endMs > s.startMs);
    }

    const ok = Object.values(checks).every(Boolean);
    out({ ok, checks, realSpeechFixture: realSpeech, transcript });
    if (!ok) process.exit(1);
  } finally {
    for (const id of ids) rmSync(pathsFor(id).root, { recursive: true, force: true });
  }
});
