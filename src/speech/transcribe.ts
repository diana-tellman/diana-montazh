import { createRequire } from "node:module";
import { join } from "node:path";
import { ensureModel, type ModelId } from "./models";
import { estimateWords, type Segment, type Transcript } from "./transcript";

const require = createRequire(import.meta.url);

type SherpaWave = { samples: Float32Array; sampleRate: number };
type Sherpa = {
  readWave(path: string): SherpaWave;
  Vad: new (cfg: object, bufferSec: number) => {
    acceptWaveform(s: Float32Array): void;
    isEmpty(): boolean;
    front(): { start: number; samples: Float32Array };
    pop(): void;
    flush(): void;
  };
  OfflineRecognizer: new (cfg: object) => {
    createStream(): { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void; setOption(k: string, v: string): void };
    decode(s: unknown): void;
    getResult(s: unknown): { text: string; lang?: string };
  };
};

/** Typical Whisper hallucinations on breath/noise; dropped when a phrase consists only of them. */
const HALLUCINATIONS = [
  /^продолжение следует\.*$/i, /^субтитры .*$/i, /^редактор субтитров.*$/i, /^спасибо за просмотр!?$/i,
  /^thank you( for watching)?[.!]*$/i, /^\[.*\]$/, /^\(.*\)$/, /^[.…\s]*$/,
];

/** Whisper sometimes loops ("ағағағаға…", "да да да да да …"). Detect a short unit repeated many times. */
export function isRepetitionLoop(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  if (/(.{1,6}?)\1{6,}/u.test(t)) return true;
  const words = t.toLowerCase().split(" ").filter(Boolean);
  if (words.length >= 8) {
    const uniq = new Set(words).size;
    if (uniq / words.length < 0.25) return true;
  }
  return false;
}

export type SpeechPhrase = { startMs: number; endMs: number; samples: Float32Array };

/** Split 16 kHz mono audio into phrases with Silero VAD (measured boundaries). */
export function detectPhrases(sherpa: Sherpa, wave: SherpaWave, vadModel: string): SpeechPhrase[] {
  if (wave.sampleRate !== 16000) throw new Error(`VAD ожидает 16 кГц, получено ${wave.sampleRate}`);
  const windowSize = 512;
  const vad = new sherpa.Vad(
    {
      sileroVad: { model: vadModel, threshold: 0.5, minSilenceDuration: 0.3, minSpeechDuration: 0.2, maxSpeechDuration: 8, windowSize },
      sampleRate: 16000,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    },
    120,
  );
  const out: SpeechPhrase[] = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      const seg = vad.front();
      vad.pop();
      // Copy: the native buffer may be reused.
      const samples = new Float32Array(seg.samples);
      out.push({ startMs: Math.round((seg.start / 16000) * 1000), endMs: Math.round(((seg.start + samples.length) / 16000) * 1000), samples });
    }
  };
  for (let i = 0; i + windowSize <= wave.samples.length; i += windowSize) {
    vad.acceptWaveform(wave.samples.subarray(i, i + windowSize));
    drain();
  }
  vad.flush();
  drain();
  return out;
}

export type TranscribeOptions = {
  wav16k: string;
  modelsRoot: string;
  language: "kk" | "ru" | "en" | null;
  model?: Extract<ModelId, "whisper-turbo" | "whisper-tiny">;
  threads?: number;
  log?: (s: string) => void;
};

/** Speech → phrases with measured boundaries and estimated word timing. Runs locally on CPU. */
export async function transcribe(o: TranscribeOptions): Promise<Transcript> {
  const sherpa = require("sherpa-onnx-node") as Sherpa;
  const modelId = o.model ?? "whisper-turbo";
  const [asrDir, vadDir] = [await ensureModel(o.modelsRoot, modelId, o.log), await ensureModel(o.modelsRoot, "silero-vad", o.log)];
  const prefix = modelId === "whisper-turbo" ? "turbo" : "tiny";

  const wave = sherpa.readWave(o.wav16k);
  const durationMs = Math.round((wave.samples.length / wave.sampleRate) * 1000);
  const phrases = detectPhrases(sherpa, wave, join(vadDir, "silero_vad.onnx"));
  o.log?.(`Найдено фраз: ${phrases.length}. Распознавание…`);

  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: join(asrDir, `${prefix}-encoder.int8.onnx`),
        decoder: join(asrDir, `${prefix}-decoder.int8.onnx`),
        language: o.language ?? "",
        task: "transcribe",
        tailPaddings: -1,
      },
      tokens: join(asrDir, `${prefix}-tokens.txt`),
      numThreads: o.threads ?? 4,
      provider: "cpu",
      debug: 0,
    },
  });

  const segments: Segment[] = [];
  const notes: string[] = [];
  const langs = new Map<string, number>();
  let dropped = 0;
  let loops = 0;
  for (const p of phrases) {
    const s = recognizer.createStream();
    // Default limit (6 tokens/s) truncates fast speech; Kazakh words split into many tokens.
    s.setOption("max_tokens_per_second", "20");
    s.acceptWaveform({ sampleRate: 16000, samples: p.samples });
    recognizer.decode(s);
    const r = recognizer.getResult(s);
    const text = r.text.trim().replace(/\s+/g, " ");
    if (r.lang) langs.set(r.lang, (langs.get(r.lang) ?? 0) + 1);
    if (!text || HALLUCINATIONS.some((h) => h.test(text))) {
      dropped++;
      continue;
    }
    if (isRepetitionLoop(text)) {
      // Keep the measured phrase timing, but no invented text: the user must type/confirm it.
      loops++;
      segments.push({ startMs: p.startMs, endMs: p.endMs, text: "", words: [] });
      continue;
    }
    segments.push({ startMs: p.startMs, endMs: p.endMs, text, words: estimateWords(text, p.startMs, p.endMs) });
  }
  if (loops) notes.push(`Не удалось распознать фраз: ${loops} (сбой распознавания). Их время сохранено — текст нужно уточнить или загрузить сценарий.`);
  if (dropped) notes.push(`Отброшено фраз без речи/с типичными ошибками распознавания: ${dropped}.`);
  const detected = [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const language = o.language ?? (detected ? detected.replace(/[<>|]/g, "") : null);
  if (language === "kk") notes.push("Казахская речь распознаётся с ошибками чаще, чем русская/английская: проверьте текст в сториборде.");
  if (modelId === "whisper-tiny") notes.push("Использована тестовая модель tiny — качество низкое.");

  return {
    version: 1,
    source: "asr",
    model: modelId,
    language,
    durationMs,
    timing: { segments: "measured", words: "estimated" },
    needsReview: true,
    notes,
    segments,
  };
}
