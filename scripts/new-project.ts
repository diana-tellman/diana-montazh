/**
 * npm run new -- --name <name> [--request "<user words>"] [--file <video|audio>] [--script <txt>]
 *                [--voiceover <audio>] [--mode expert-video|text-to-video|audio-to-video] [--lang kk|ru|en] [--keep-fps]
 *
 * Detects the mode (or asks), creates projects/<id>/ and ingests the material.
 * Exit code 3 = the user must answer a question (printed as JSON) before continuing.
 */
import { existsSync } from "node:fs";
import { detectMode } from "../src/core/modes";
import { probe, soundActivityRatio } from "../src/core/media";
import { ModeSchema } from "../src/core/project";
import { createProject, slugify } from "../src/core/store";
import { ingestMedia, ingestScript, ingestVoiceover } from "../src/core/ingest";
import { main, out, parseArgs, str } from "./_cli";

main(async () => {
  const { opt } = parseArgs();
  const file = str(opt.file);
  const script = str(opt.script);
  const voiceover = str(opt.voiceover);
  for (const f of [file, script, voiceover]) if (f && !existsSync(f)) throw new Error(`Файл не найден: ${f}`);
  const lang = (str(opt.lang) ?? null) as "kk" | "ru" | "en" | null;

  let mode = str(opt.mode) ? ModeSchema.parse(opt.mode) : undefined;
  let reason = "Режим указан явно.";
  if (!mode) {
    let hasVideo = false;
    let hasAudioOnly = false;
    let speechLikely: boolean | null = null;
    if (file) {
      const info = await probe(file);
      hasVideo = info.kind === "video";
      hasAudioOnly = info.kind === "audio";
      if (info.audio) speechLikely = (await soundActivityRatio(file, info.durationSec)) > 0.3;
    }
    const d = detectMode({ request: str(opt.request) ?? "", hasVideo, hasAudioOnly, hasScript: !!script, speechLikely });
    if (d.kind === "ask") {
      out({ needsAnswer: true, question: d.question, options: d.options, reason: d.reason });
      process.exit(3);
    }
    mode = d.mode;
    reason = d.reason;
  }

  const base = slugify(str(opt.name) ?? "project");
  const id = `${base}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  let project = createProject({ id, mode, language: lang });
  let report: unknown = null;
  if (file && mode !== "text-to-video") ({ project, report } = await ingestMedia(project, file, { keepSourceFps: opt["keep-fps"] === true }));
  if (mode === "text-to-video") {
    if (voiceover) project = await ingestVoiceover(project, voiceover);
    if (script) project = ingestScript(project, script);
  }
  out({ id: project.id, mode: project.mode, reason, status: project.status, voice: project.voice, ingest: report });
});
