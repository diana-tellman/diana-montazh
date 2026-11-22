/**
 * npm run new -- [--name <name>] [--style "<user's style wishes>"] [--lang kk|ru|en]
 *                [--voice <file>] [--script <txt>] [--keep-fps] <file> [<file> …]
 *
 * Files: videos, photos (JPEG/PNG/HEIC) and/or one voice recording (MP3/M4A/WAV).
 * Detects the mode (or asks), creates projects/<id>/ and prepares every file.
 * Exit code 3 = a question for the user is printed as JSON; re-run with --voice <file>.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { detectMode } from "../src/core/modes";
import { attachScript, classify, ingestMaterials } from "../src/core/ingest";
import { createProject, slugify } from "../src/core/store";
import { main, out, parseArgs, str } from "./_cli";

main(async () => {
  const { pos, opt } = parseArgs();
  const script = str(opt.script);
  const voiceOpt = str(opt.voice);
  const files = [...pos];
  if (voiceOpt && !files.includes(voiceOpt)) files.push(voiceOpt);
  for (const f of [...files, ...(script ? [script] : [])]) if (!existsSync(f)) throw new Error(`Файл не найден: ${f}`);
  const lang = (str(opt.lang) ?? null) as "kk" | "ru" | "en" | null;

  const classified = [];
  for (const f of files) classified.push(await classify(f));

  let voiceFile = voiceOpt;
  let mode: "expert-video" | "voice-over-visuals";
  let reason: string;
  if (voiceFile) {
    const c = classified.find((x) => x.file === voiceFile)!;
    mode = c.info.kind === "video" ? "expert-video" : "voice-over-visuals";
    reason = "Источник голоса указан явно.";
  } else {
    const d = detectMode({
      videos: classified.filter((c) => c.info.kind === "video").map((c) => ({ name: basename(c.file), speechLikely: c.speechLikely })),
      audios: classified.filter((c) => c.info.kind === "audio").map((c) => basename(c.file)),
      photos: classified.filter((c) => c.info.kind === "image").map((c) => basename(c.file)),
      hasScript: !!script,
    });
    if (d.kind === "ask") {
      out({ needsAnswer: true, question: d.question, reason: d.reason, files: classified.map((c) => ({ file: c.file, kind: c.info.kind, speechLikely: c.speechLikely })) });
      process.exit(3);
    }
    mode = d.mode;
    reason = d.reason;
    // expert-video: the first speaking video carries the voice; voice-over-visuals: the audio file.
    voiceFile =
      mode === "expert-video"
        ? classified.find((c) => c.info.kind === "video" && c.speechLikely)!.file
        : classified.find((c) => c.info.kind === "audio")!.file;
  }

  const id = `${slugify(str(opt.name) ?? "video")}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  let project = createProject({ id, mode, language: lang, styleRequest: str(opt.style) ?? "" });
  project = await ingestMaterials(project, { files: classified, voiceFile, keepSourceFps: opt["keep-fps"] === true });
  if (script) project = attachScript(project, script);
  out({
    id: project.id,
    mode: project.mode,
    reason,
    status: project.status,
    assets: project.assets.map((a) => ({ id: a.id, role: a.role, kind: a.info.kind, durationSec: a.info.durationSec, notes: a.notes })),
  });
});
