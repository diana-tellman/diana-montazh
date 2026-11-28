/**
 * npm run setup — prepares EVERYTHING in advance (used by the cloud environment setup script):
 * Python analysis env (MediaPipe, rembg), face/segmentation models, background-removal model, speech models (Whisper turbo + VAD).
 * Safe to run repeatedly: finished parts are verified (SHA-256) and skipped.
 */
import { ensureAnalysisEnv, runAnalysis } from "../src/analysis/python";
import { MODELS_DIR } from "../src/core/store";
import { ensureModel } from "../src/speech/models";
import { main, out } from "./_cli";

main(async () => {
  const log = (s: string) => console.error(s);
  const t0 = Date.now();
  await ensureAnalysisEnv(log);
  await ensureModel(MODELS_DIR, "silero-vad", log);
  await ensureModel(MODELS_DIR, "whisper-turbo", log);
  log("Модель rembg (фон из фото, ~176 МБ, один раз)…");
  await runAnalysis(["cutout", "--prefetch"], log);
  out({ ready: true, seconds: Math.round((Date.now() - t0) / 1000) });
});
