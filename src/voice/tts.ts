import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Project } from "../core/project";
import { hasReached } from "../core/state";
import { findVoice, type VoiceEntry } from "./voices";

const run = promisify(execFile);

export class VoicePolicyError extends Error {}

/**
 * Hard rules, enforced in code (and covered by tests):
 * 1. MODE 1 / MODE 3 keep the original voice. A synthetic narrator replaces a real
 *    person's voice only with explicit consent (`voiceReplacementConsent`).
 * 2. TTS narration is generated only after the storyboard is approved.
 * 3. Draft (eSpeak) voices never go into a final render unless `allowDraftVoice` is set.
 * 4. No voice cloning: no provider accepts a reference recording.
 */
export function assertCanSynthesize(project: Project, opts: { forPreview: boolean }): void {
  if (project.voice.type !== "tts") throw new VoicePolicyError("Источник голоса проекта — не TTS.");
  if ((project.mode === "expert-video" || project.mode === "audio-to-video") && !project.voiceReplacementConsent) {
    throw new VoicePolicyError(
      "В этом проекте есть оригинальный голос человека. Замена на дикторский голос возможна только с явного согласия пользователя.",
    );
  }
  if (!opts.forPreview && !hasReached(project, "approved")) {
    throw new VoicePolicyError("Финальная озвучка создаётся только после одобрения сториборда.");
  }
}

export function assertFinalVoiceAllowed(voice: VoiceEntry, allowDraftVoice: boolean): void {
  if (voice.quality === "draft" && !allowDraftVoice) {
    throw new VoicePolicyError(
      `Голос ${voice.id} — черновой (роботизированный). Для финала загрузите готовую озвучку или используйте Piper; ` +
        "либо подтвердите, что черновой голос допустим.",
    );
  }
}

export type Availability = { available: boolean; detail: string };

export async function espeakAvailable(): Promise<Availability> {
  try {
    const { stdout } = await run("espeak-ng", ["--version"]);
    return { available: true, detail: stdout.trim() };
  } catch {
    return { available: false, detail: "espeak-ng не установлен (apt-get install -y espeak-ng)" };
  }
}

export function piperModelPath(modelsDir: string, voice: VoiceEntry): string {
  return join(modelsDir, "piper", `${voice.id}.onnx`);
}

export async function piperAvailable(modelsDir: string, voice: VoiceEntry): Promise<Availability> {
  try {
    await run("python3", ["-c", "import piper"]);
  } catch {
    return { available: false, detail: "Python-пакет piper-tts не установлен (pip install piper-tts)" };
  }
  const model = piperModelPath(modelsDir, voice);
  if (!existsSync(model) || !existsSync(model + ".json")) {
    return { available: false, detail: `Нет модели ${model}. Скачайте: npm run voice -- download ${voice.id}` };
  }
  return { available: true, detail: model };
}

/** Synthesize one text segment to a 48 kHz mono WAV. */
export async function synthesizeSegment(voice: VoiceEntry, text: string, outWav: string, modelsDir: string): Promise<void> {
  const raw = outWav.replace(/\.wav$/, ".raw.wav");
  if (voice.provider === "espeak-draft") {
    const lang = voice.id.replace(/^espeak-/, "");
    await run("espeak-ng", ["-v", lang, "-s", "150", "-w", raw, text]);
  } else {
    const model = piperModelPath(modelsDir, voice);
    await new Promise<void>((resolve, reject) => {
      const p = spawn("python3", ["-m", "piper", "-m", model, "-f", raw], { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += String(d)));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`piper exited ${code}: ${err.slice(-500)}`))));
      p.stdin.end(text);
    });
  }
  await run("ffmpeg", ["-hide_banner", "-y", "-i", raw, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outWav]);
}

export async function wavDuration(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return Number(stdout.trim());
}

export type NarrationSegment = { sceneId: string; text: string };
export type WordTiming = { text: string; startMs: number; endMs: number; timing: "estimated" | "measured" };
export type SegmentTiming = { sceneId: string; text: string; startSec: number; endSec: number; words: WordTiming[] };

/**
 * Estimate word timings inside a synthesized segment from character length.
 * Labelled "estimated" — replaced with measured timings when forced alignment
 * (Whisper) is available.
 */
export function estimateWords(text: string, startSec: number, endSec: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,!?;:]$/.test(w) ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, endSec - startSec) * 1000;
  let t = startSec * 1000;
  return words.map((w, i) => {
    const d = (span * (weights[i] ?? 0)) / total;
    const item = { text: w, startMs: Math.round(t), endMs: Math.round(t + d), timing: "estimated" as const };
    t += d;
    return item;
  });
}

/** Lay out segment durations on the timeline with a pause between segments. */
export function layoutSegments(segs: Array<NarrationSegment & { durationSec: number }>, leadInSec = 0.3, gapSec = 0.35): SegmentTiming[] {
  let t = leadInSec;
  return segs.map((s) => {
    const startSec = t;
    const endSec = t + s.durationSec;
    t = endSec + gapSec;
    return { sceneId: s.sceneId, text: s.text, startSec, endSec, words: estimateWords(s.text, startSec, endSec) };
  });
}

/** Synthesize all segments and assemble `voiceover.wav` + `voiceover.timings.json`. */
export async function synthesizeNarration(opts: {
  voiceId: string;
  segments: NarrationSegment[];
  workDir: string;
  modelsDir: string;
  allowDraftVoice: boolean;
}): Promise<{ wav: string; timings: SegmentTiming[] }> {
  const voice = findVoice(opts.voiceId);
  if (!voice) throw new VoicePolicyError(`Неизвестный голос: ${opts.voiceId}`);
  assertFinalVoiceAllowed(voice, opts.allowDraftVoice);
  const segDir = join(opts.workDir, "tts");
  mkdirSync(segDir, { recursive: true });

  const durations: Array<NarrationSegment & { durationSec: number; file: string }> = [];
  for (const [i, s] of opts.segments.entries()) {
    const file = join(segDir, `seg-${String(i + 1).padStart(3, "0")}.wav`);
    await synthesizeSegment(voice, s.text, file, opts.modelsDir);
    durations.push({ ...s, durationSec: await wavDuration(file), file });
  }
  const timings = layoutSegments(durations);

  // Place every segment at its start time with adelay, then mix.
  const inputs = durations.flatMap((d) => ["-i", d.file]);
  const filters = timings.map((t, i) => `[${i}:a]adelay=${Math.round(t.startSec * 1000)}:all=1[a${i}]`);
  const mixIn = timings.map((_, i) => `[a${i}]`).join("");
  const total = (timings.at(-1)?.endSec ?? 0) + 0.6;
  const graph = `${filters.join(";")};${mixIn}amix=inputs=${timings.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[out]`;
  const wav = join(opts.workDir, "voiceover.wav");
  await run("ffmpeg", ["-hide_banner", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav], {
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(opts.workDir, "voiceover.timings.json"), JSON.stringify({ voice: voice.id, provider: voice.provider, timings }, null, 2));
  return { wav, timings };
}
