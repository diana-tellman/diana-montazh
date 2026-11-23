import { execFile } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { DEFAULT_ENHANCE, enhanceVoice } from "../audio/enhance";
import { probe, soundActivityRatio } from "./media";
import type { Asset, MediaInfo, Project } from "./project";
import { pathsFor, saveProject } from "./store";
import { transition } from "./state";
import { analysisAudioArgs, chooseFps, masterAudioArgs, proxyArgs } from "./transcode";

const run = promisify(execFile);
const ff = (args: string[]) => run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });

export const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".aac", ".ogg", ".opus", ".flac", ".caf"]);
export const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
export const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi", ".3gp"]);

export type Classified = { file: string; info: MediaInfo; speechLikely: boolean | null };

/** Probe a file and decide whether it is a video, an audio recording or a photo. */
export async function classify(file: string): Promise<Classified> {
  const ext = extname(file).toLowerCase();
  if (ext === ".heic" || ext === ".heif") {
    // ffmpeg cannot read HEIC; it is always a photo.
    return {
      file,
      speechLikely: null,
      info: { path: file, kind: "image", container: "heif", durationSec: 0, sizeBytes: readFileSync(file).length, video: null, audio: null },
    };
  }
  const info = await probe(file);
  let speechLikely: boolean | null = null;
  if (info.audio && info.durationSec > 0) speechLikely = (await soundActivityRatio(file, info.durationSec)) > 0.3;
  return { file, info, speechLikely };
}

/**
 * Photo → display-oriented sRGB JPEG, long side ≤ 2160 px.
 * HEIC is decoded with libheif (heic-convert), EXIF orientation is applied (sharp.rotate()).
 */
export async function preparePhoto(src: string, dest: string): Promise<MediaInfo> {
  const ext = extname(src).toLowerCase();
  let input: Buffer = readFileSync(src);
  if (ext === ".heic" || ext === ".heif") {
    const { default: convert } = await import("heic-convert");
    input = Buffer.from(await convert({ buffer: input, format: "JPEG", quality: 0.95 }));
  }
  const img = sharp(input).rotate().resize({ width: 2160, height: 2160, fit: "inside", withoutEnlargement: true }).toColorspace("srgb").jpeg({ quality: 92 });
  const { width, height, size } = await img.toFile(dest);
  return {
    path: dest,
    kind: "image",
    container: "jpeg",
    durationSec: 0,
    sizeBytes: size,
    audio: null,
    video: {
      codec: "mjpeg", width, height, codedWidth: width, codedHeight: height, rotation: 0, fps: 1, variableFrameRate: false,
      orientation: width > height ? "horizontal" : width < height ? "vertical" : "square",
      aspect: `${width}:${height}`, pixFmt: "yuvj444p", bitDepth: 8, colorTransfer: "iec61966-2-1", colorPrimaries: "bt709", colorSpace: "bt470bg", hdr: "sdr",
    },
  };
}

/** User voice → 48 kHz master, 16 kHz analysis copy, identity-preserving enhanced copy. */
async function prepareVoice(src: string, workDir: string, notes: string[]): Promise<string> {
  const master = join(workDir, "voice-master.wav");
  await ff(masterAudioArgs(src, master));
  await ff(analysisAudioArgs(src, join(workDir, "voice-16k.wav")));
  const enhanced = join(workDir, "voice-enhanced.wav");
  await enhanceVoice(master, enhanced, DEFAULT_ENHANCE);
  notes.push("Голос очищен без изменения тембра: срез гула, лёгкое шумоподавление, де-эссер, мягкая компрессия, −16 LUFS.");
  return enhanced;
}

export type IngestPlan = {
  /** Files in the order the user gave them. */
  files: Classified[];
  /** File that carries the narration (a video for expert-video, an audio file for voice-over-visuals). */
  voiceFile: string;
  keepSourceFps?: boolean;
};

/**
 * Copy the material into the project and prepare editing-ready assets:
 * video → H.264 SDR BT.709 CFR proxy; photo → oriented JPEG; voice → enhanced WAV.
 * The user's voice is never replaced or regenerated.
 */
export async function ingestMaterials(project: Project, plan: IngestPlan): Promise<Project> {
  const p = pathsFor(project.id);
  const rel = (f: string) => relative(p.root, f);
  const assets: Asset[] = [];
  let voiceAssetId: string | null = null;
  const mainVideo = plan.files.find((f) => f.file === plan.voiceFile && f.info.kind === "video");
  const fps = chooseFps(mainVideo?.info.video?.fps, plan.keepSourceFps ?? false);

  for (const [i, c] of plan.files.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const ext = extname(c.file).toLowerCase();
    const original = join(p.input, `${n}-${basename(c.file).replace(/[^\w.\-]+/g, "_")}`);
    copyFileSync(c.file, original);
    const notes: string[] = [];
    const isVoice = c.file === plan.voiceFile;

    if (c.info.kind === "image") {
      const prepared = join(p.work, `photo-${n}.jpg`);
      const info = await preparePhoto(original, prepared);
      if (ext === ".heic" || ext === ".heif") notes.push("HEIC сконвертирован в JPEG.");
      assets.push({ id: `photo-${n}`, role: "photo", original: rel(original), prepared: rel(prepared), info, notes });
      continue;
    }

    if (c.info.kind === "video" && c.info.video) {
      const v = c.info.video;
      if (v.hdr !== "sdr") notes.push(`HDR (${v.hdr.toUpperCase()}) → SDR BT.709 (tone mapping).`);
      if (v.variableFrameRate) notes.push(`Переменная частота кадров → постоянная ${fps} fps.`);
      if (v.rotation) notes.push(`Учтён поворот ${v.rotation}°.`);
      const prepared = join(p.work, `video-${n}.mp4`);
      await ff(proxyArgs(original, prepared, c.info, { fps, maxShortSide: 1080 }));
      const role = isVoice ? "main-video" : "broll-video";
      if (!isVoice && c.info.audio) notes.push("Звук этого видео не используется как озвучка.");
      assets.push({ id: `video-${n}`, role, original: rel(original), prepared: rel(prepared), info: c.info, notes });
      if (isVoice) {
        if (!c.info.audio) throw new Error(`В видео ${basename(c.file)} нет звуковой дорожки.`);
        const vnotes: string[] = [];
        const enhanced = await prepareVoice(prepared, p.work, vnotes);
        assets.push({ id: "voice", role: "voice", original: rel(original), prepared: rel(enhanced), info: c.info, notes: vnotes });
        voiceAssetId = "voice";
      }
      continue;
    }

    if (c.info.kind === "audio") {
      if (!isVoice) {
        notes.push("Дополнительная аудиозапись не используется (основная озвучка — другая).");
        continue;
      }
      const enhanced = await prepareVoice(original, p.work, notes);
      assets.push({ id: "voice", role: "voice", original: rel(original), prepared: rel(enhanced), info: c.info, notes });
      voiceAssetId = "voice";
      continue;
    }

    throw new Error(`Не удалось распознать файл ${basename(c.file)} как видео, фото или аудио.`);
  }

  if (!voiceAssetId) throw new Error("Не найдена голосовая запись пользователя.");
  const summary = assets.flatMap((a) => a.notes).join(" ");
  const next = transition({ ...project, assets, voiceAssetId }, "ingested", summary || "Материалы подготовлены");
  writeFileSync(join(p.work, "ingest.json"), JSON.stringify({ fps, assets }, null, 2));
  saveProject(next);
  return next;
}

/** Optional script: exact words for captions; timing still comes from the user's audio. */
export function attachScript(project: Project, file: string): Project {
  const p = pathsFor(project.id);
  const dest = join(p.input, "script" + (extname(file) || ".txt"));
  copyFileSync(file, dest);
  const next = { ...project, scriptFile: relative(p.root, dest), updatedAt: new Date().toISOString() };
  saveProject(next);
  return next;
}
