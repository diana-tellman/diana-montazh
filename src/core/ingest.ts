import { execFile } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_ENHANCE, enhanceVoice } from "../audio/enhance";
import { probe, soundActivityRatio } from "./media";
import type { MediaInfo, Project } from "./project";
import { pathsFor, saveProject } from "./store";
import { transition } from "./state";
import { analysisAudioArgs, chooseFps, masterAudioArgs, proxyArgs } from "./transcode";

const run = promisify(execFile);
const ff = (args: string[]) => run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });

export type IngestReport = {
  source: MediaInfo;
  fps: number;
  proxy: string | null;
  analysisAudio: string | null;
  masterAudio: string | null;
  enhancedVoice: string | null;
  soundActivity: number | null;
  notes: string[];
};

const safeName = (file: string) => "source" + extname(file).toLowerCase();

/**
 * Copy the source into the project, inspect it and prepare editing media:
 * - video → proxy.mp4 (H.264 SDR BT.709 CFR) for Remotion
 * - any audio → voice-16k.wav (analysis) + voice-master.wav (48 kHz)
 * - MODE 1/3 → voice-enhanced.wav (identity-preserving clean-up)
 */
export async function ingestMedia(project: Project, file: string, opts: { keepSourceFps?: boolean } = {}): Promise<{ project: Project; report: IngestReport }> {
  const p = pathsFor(project.id);
  const dest = join(p.input, safeName(file));
  copyFileSync(file, dest);
  const info = await probe(dest);
  const notes: string[] = [];

  if (info.kind === "unknown" || info.kind === "image") {
    throw new Error(`Файл ${basename(file)} не является видео или аудио (определено: ${info.kind}).`);
  }
  if (project.mode === "expert-video" && info.kind !== "video") throw new Error("Режим expert-video требует видеофайл.");
  if (project.mode === "audio-to-video" && info.kind !== "audio") {
    notes.push("Передано видео в режиме audio-to-video: используется только звуковая дорожка.");
  }

  const fps = chooseFps(info.video?.fps, opts.keepSourceFps ?? false);
  let proxy: string | null = null;
  if (info.video && project.mode === "expert-video") {
    if (info.video.hdr !== "sdr") notes.push(`Исходник HDR (${info.video.hdr.toUpperCase()}): выполнен tone mapping в SDR BT.709.`);
    if (info.video.variableFrameRate) notes.push(`Переменная частота кадров → приведена к постоянной ${fps} fps.`);
    if (info.video.rotation) notes.push(`Учтён поворот ${info.video.rotation}°.`);
    proxy = join(p.work, "proxy.mp4");
    await ff(proxyArgs(dest, proxy, info, { fps, maxShortSide: 1080 }));
  }

  let analysisAudio: string | null = null;
  let masterAudio: string | null = null;
  let enhancedVoice: string | null = null;
  let soundActivity: number | null = null;
  if (info.audio) {
    analysisAudio = join(p.work, "voice-16k.wav");
    masterAudio = join(p.work, "voice-master.wav");
    await ff(analysisAudioArgs(dest, analysisAudio));
    await ff(masterAudioArgs(dest, masterAudio));
    soundActivity = await soundActivityRatio(dest, info.durationSec);
    if (project.voice.type === "original") {
      enhancedVoice = join(p.work, "voice-enhanced.wav");
      await enhanceVoice(masterAudio, enhancedVoice, DEFAULT_ENHANCE);
      notes.push("Голос очищен без изменения тембра: срез гула, лёгкое шумоподавление, де-эссер, мягкая компрессия, −16 LUFS.");
    }
  } else if (project.mode === "expert-video") {
    notes.push("В видео нет звуковой дорожки — субтитры по речи невозможны, нужен текст или озвучка.");
  }

  const report: IngestReport = { source: info, fps, proxy, analysisAudio, masterAudio, enhancedVoice, soundActivity, notes };
  writeFileSync(join(p.work, "ingest.json"), JSON.stringify(report, null, 2));
  const next = transition({ ...project, source: info }, "ingested", notes.join(" ") || "Исходник подготовлен");
  saveProject(next);
  return { project: next, report };
}

/** MODE 2: store the script text. */
export function ingestScript(project: Project, file: string): Project {
  const p = pathsFor(project.id);
  const dest = join(p.input, "script" + (extname(file) || ".txt"));
  copyFileSync(file, dest);
  const next = transition({ ...project, scriptFile: dest }, "ingested", "Сценарий сохранён");
  saveProject(next);
  return next;
}

/** MODE 2 with a ready-made voiceover: keep it as the narration master. */
export async function ingestVoiceover(project: Project, file: string): Promise<Project> {
  const p = pathsFor(project.id);
  const dest = join(p.input, "voiceover" + extname(file).toLowerCase());
  copyFileSync(file, dest);
  const info = await probe(dest);
  if (!info.audio) throw new Error("В файле озвучки нет аудиодорожки.");
  const master = join(p.work, "voice-master.wav");
  await ff(masterAudioArgs(dest, master));
  await ff(analysisAudioArgs(dest, join(p.work, "voice-16k.wav")));
  await enhanceVoice(master, join(p.work, "voice-enhanced.wav"), DEFAULT_ENHANCE);
  const next: Project = { ...project, voice: { type: "uploaded", file: dest }, updatedAt: new Date().toISOString() };
  saveProject(next);
  return next;
}
