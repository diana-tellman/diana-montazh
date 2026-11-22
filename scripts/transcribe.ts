/**
 * npm run transcribe -- <id> [--import <srt|vtt|txt>] [--model whisper-turbo|whisper-tiny]
 *
 * Recognises the user's own voice locally (models download automatically on first use),
 * or imports ready-made timed text. If the project has a script, its exact words are
 * used for captions and the timing comes from the audio.
 * Writes work/transcript.json and work/captions.json (Remotion caption format).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alignScript } from "../src/speech/align";
import { importTranscript } from "../src/speech/import";
import { transcribe } from "../src/speech/transcribe";
import { toRemotionCaptions, TranscriptSchema, type Transcript } from "../src/speech/transcript";
import { loadProject, MODELS_DIR, pathsFor } from "../src/core/store";
import { main, out, parseArgs, str } from "./_cli";

main(async () => {
  const { pos, opt } = parseArgs();
  const project = loadProject(pos[0] ?? "");
  const p = pathsFor(project.id);
  const voice = project.assets.find((a) => a.id === project.voiceAssetId);
  if (!voice) throw new Error("В проекте нет голосовой записи.");
  const wav16k = join(p.work, "voice-16k.wav");
  const durationMs = Math.round(voice.info.durationSec * 1000);

  const t0 = Date.now();
  let t: Transcript;
  const imp = str(opt.import);
  if (imp) t = importTranscript(readFileSync(imp, "utf8"), durationMs);
  else {
    const model = (str(opt.model) ?? "whisper-turbo") as "whisper-turbo" | "whisper-tiny";
    t = await transcribe({ wav16k, modelsRoot: MODELS_DIR, language: project.language, model, log: (s) => console.error(s) });
  }
  let matchRatio: number | null = null;
  if (project.scriptFile && !imp) {
    ({ transcript: t, matchRatio } = alignScript(t, readFileSync(join(p.root, project.scriptFile), "utf8")));
  }
  TranscriptSchema.parse(t);
  writeFileSync(join(p.work, "transcript.json"), JSON.stringify(t, null, 2));
  writeFileSync(join(p.work, "captions.json"), JSON.stringify(toRemotionCaptions(t), null, 2));
  out({
    id: project.id,
    source: t.source,
    model: t.model,
    language: t.language,
    phrases: t.segments.length,
    words: t.segments.reduce((n, s) => n + s.words.length, 0),
    timing: t.timing,
    needsReview: t.needsReview,
    matchRatio,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    notes: t.notes,
    text: t.segments.map((s) => `[${(s.startMs / 1000).toFixed(1)}–${(s.endMs / 1000).toFixed(1)}] ${s.text}`),
  });
});
