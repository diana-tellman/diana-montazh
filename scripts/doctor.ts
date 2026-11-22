/** npm run doctor — what works in THIS environment (honest capability report). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findBrowserExecutable } from "../src/render/browser";
import { espeakAvailable } from "../src/voice/tts";
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
  const espeak = await espeakAvailable();
  const report = {
    node: process.version,
    ffmpeg,
    ffprobe,
    browser: browser ?? "не найден — Remotion скачает chrome-headless-shell сам (нужна сеть)",
    tts: {
      espeakDraft: espeak.available,
      piperPackage: await py("piper"),
    },
    stt: { fasterWhisper: await py("faster_whisper") },
    faces: { mediapipe: await py("mediapipe") },
    network: {
      huggingface: await reach("https://huggingface.co"),
      mediapipeModels: await reach("https://storage.googleapis.com/mediapipe-models/"),
      googleDrive: await reach("https://drive.google.com"),
    },
  };
  const blockers: string[] = [];
  if (!ffmpeg || !ffprobe) blockers.push("Нет ffmpeg/ffprobe — видео обработать нельзя.");
  const limits: string[] = [];
  if (!report.network.huggingface) limits.push("huggingface.co закрыт: Whisper и Piper в этой сессии недоступны → импорт субтитров / загруженная озвучка / GitHub Actions.");
  if (!espeak.available) limits.push("espeak-ng не установлен: черновая озвучка недоступна (apt-get install -y espeak-ng).");
  out({ ...report, blockers, limits, ok: blockers.length === 0 });
});
