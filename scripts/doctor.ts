/** npm run doctor — what works in THIS environment (honest capability report). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findBrowserExecutable } from "../src/render/browser";
import { MODELS, verifyModel } from "../src/speech/models";
import { MODELS_DIR } from "../src/core/store";
import { main, out } from "./_cli";

const run = promisify(execFile);
async function cmd(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(bin, args);
    return (stdout || stderr).split("\n")[0]!.trim();
  } catch {
    return null;
  }
}
async function reach(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    return r.status < 500;
  } catch {
    return false;
  }
}
async function py(mod: string): Promise<boolean> {
  return (await cmd("python3", ["-c", `import ${mod}; print('ok')`])) === "ok";
}

main(async () => {
  const ffmpeg = await cmd("ffmpeg", ["-version"]);
  const ffprobe = await cmd("ffprobe", ["-version"]);
  const browser = findBrowserExecutable();
  const report = {
    node: process.version,
    ffmpeg,
    ffprobe,
    browser: browser ?? "не найден — Remotion скачает chrome-headless-shell сам (нужна сеть)",
    speech: {
      engine: "sherpa-onnx (Whisper large-v3-turbo + Silero VAD), локально на CPU",
      modelsReady: Object.fromEntries(await Promise.all(Object.keys(MODELS).map(async (id) => [id, await verifyModel(MODELS_DIR, id as keyof typeof MODELS)]))),
    },
    faces: { mediapipe: await py("mediapipe") },
    network: {
      githubReleases: await reach("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"),
      mediapipeModels: await reach("https://storage.googleapis.com/mediapipe-models/"),
      googleDrive: await reach("https://drive.google.com"),
    },
  };
  const blockers: string[] = [];
  if (!ffmpeg || !ffprobe) blockers.push("Нет ffmpeg/ffprobe — видео обработать нельзя.");
  const limits: string[] = [];
  if (!report.network.githubReleases && !Object.values(report.speech.modelsReady).every(Boolean))
    limits.push("Загрузки релизов GitHub недоступны: автоматическое распознавание речи невозможно → импорт текста с таймкодами (SRT/VTT).");
  out({ ...report, blockers, limits, ok: blockers.length === 0 });
});
