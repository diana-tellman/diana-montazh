/**
 * Narration tools (MODE 2).
 *   npm run voice -- list [kk|ru|en]
 *   npm run voice -- check <voiceId>
 *   npm run voice -- download <voiceId>             # Piper model from Hugging Face (needs network access)
 *   npm run voice -- use <projectId> <audioFile>     # ready-made voiceover instead of TTS
 *   npm run voice -- set <projectId> <voiceId>
 *   npm run voice -- preview <projectId> --segments <json> # draft narration for storyboard timing (before approval)
 *   npm run voice -- synth <projectId> --segments <json> [--allow-draft]  # final narration (after approval)
 *
 * segments JSON: [{ "sceneId": "s1", "text": "..." }, ...]
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ingestVoiceover } from "../src/core/ingest";
import { loadProject, MODELS_DIR, pathsFor, saveProject } from "../src/core/store";
import { transition } from "../src/core/state";
import { assertCanSynthesize, espeakAvailable, piperAvailable, piperModelPath, synthesizeNarration, type NarrationSegment } from "../src/voice/tts";
import { findVoice, piperUrl, voicesFor, VOICES, type Lang } from "../src/voice/voices";
import { main, out, parseArgs, str } from "./_cli";

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} при загрузке ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest + ".part"));
  renameSync(dest + ".part", dest);
}

function readSegments(file: string | undefined): NarrationSegment[] {
  if (!file) throw new Error("Нужен --segments <json>");
  const data = JSON.parse(readFileSync(file, "utf8")) as NarrationSegment[];
  if (!Array.isArray(data) || data.some((s) => !s.sceneId || !s.text?.trim())) throw new Error("Неверный формат segments");
  return data;
}

main(async () => {
  const { pos, opt } = parseArgs();
  const [cmd, a, b] = pos;

  if (cmd === "list") {
    const list = a ? voicesFor(a as Lang) : VOICES;
    out(list.map((v) => ({ id: v.id, language: v.language, label: v.label, quality: v.quality, provider: v.provider })));
    return;
  }

  if (cmd === "check") {
    const v = findVoice(a ?? "");
    if (!v) throw new Error(`Неизвестный голос ${a}`);
    out(v.provider === "piper" ? await piperAvailable(MODELS_DIR, v) : await espeakAvailable());
    return;
  }

  if (cmd === "download") {
    const v = findVoice(a ?? "");
    if (!v || v.provider !== "piper") throw new Error("download: укажите Piper-голос (npm run voice -- list)");
    const model = piperModelPath(MODELS_DIR, v);
    try {
      await download(piperUrl(v, "onnx"), model);
      await download(piperUrl(v, "json"), model + ".json");
      await download(piperUrl(v, "card"), model.replace(/\.onnx$/, ".MODEL_CARD.md"));
    } catch (e) {
      throw new Error(
        `Не удалось скачать модель (${e instanceof Error ? e.message : e}). ` +
          "Скорее всего huggingface.co закрыт сетевыми настройками окружения. Варианты: разрешить хост в настройках окружения, " +
          "использовать GitHub Actions, или загрузить готовую озвучку (npm run voice -- use).",
      );
    }
    out({ downloaded: model, licence: "Прочитайте MODEL_CARD рядом с моделью перед публикацией видео." });
    return;
  }

  if (cmd === "use") {
    if (!a || !b || !existsSync(b)) throw new Error("use <projectId> <audioFile>");
    const p = await ingestVoiceover(loadProject(a), b);
    out({ id: p.id, voice: p.voice });
    return;
  }

  if (cmd === "set") {
    const p = loadProject(a ?? "");
    const v = findVoice(b ?? "");
    if (!v) throw new Error(`Неизвестный голос ${b}`);
    p.voice = { type: "tts", provider: v.provider, voice: v.id, language: v.language };
    if (opt["consent-replace-original"] === true) p.voiceReplacementConsent = true;
    saveProject(p);
    out({ id: p.id, voice: p.voice, voiceReplacementConsent: p.voiceReplacementConsent });
    return;
  }

  if (cmd === "preview" || cmd === "synth") {
    const project = loadProject(a ?? "");
    const forPreview = cmd === "preview";
    assertCanSynthesize(project, { forPreview });
    if (project.voice.type !== "tts") throw new Error("unreachable");
    const segments = readSegments(str(opt.segments));
    const workDir = forPreview ? join(pathsFor(project.id).work, "preview") : pathsFor(project.id).work;
    mkdirSync(workDir, { recursive: true });
    const { wav, timings } = await synthesizeNarration({
      voiceId: forPreview ? project.voice.voice : project.voice.voice,
      segments,
      workDir,
      modelsDir: MODELS_DIR,
      allowDraftVoice: forPreview || opt["allow-draft"] === true,
    });
    if (!forPreview) saveProject(transition(project, "voiced", `Озвучка ${project.voice.voice}`));
    out({ wav, segments: timings.length, durationSec: timings.at(-1)?.endSec ?? 0, timing: "estimated" });
    return;
  }

  throw new Error("Команды: list | check | download | use | set | preview | synth");
});
