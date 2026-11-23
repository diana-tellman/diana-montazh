import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Speech models are downloaded automatically on first use from the official
 * k2-fsa/sherpa-onnx GitHub releases (Apache-2.0 project; Whisper weights are MIT).
 * GitHub release downloads are in the default allow-list of Claude Code cloud
 * environments, so students need no network configuration and no manual install.
 * Every file is verified against a pinned SHA-256.
 */
const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

export type ModelId = "whisper-turbo" | "whisper-tiny" | "silero-vad" | "mp-face-landmarker" | "mp-selfie-multiclass";

type ModelSpec = {
  id: ModelId;
  label: string;
  url: string;
  archive: "tar.bz2" | "file";
  /** Approximate download size, MB (shown to the user). */
  downloadMb: number;
  /** Folder under models/ (default: speech/<id>). */
  folder?: string;
  /** File → expected sha256, relative to the model folder. */
  files: Record<string, string>;
};

export const MODELS: Record<ModelId, ModelSpec> = {
  "whisper-turbo": {
    id: "whisper-turbo",
    label: "Whisper large-v3-turbo (int8) — основная модель, kk/ru/en",
    url: RELEASE + "sherpa-onnx-whisper-turbo.tar.bz2",
    archive: "tar.bz2",
    downloadMb: 564,
    files: {
      "turbo-encoder.int8.onnx": "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b",
      "turbo-decoder.int8.onnx": "20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547",
      "turbo-tokens.txt": "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
    },
  },
  "whisper-tiny": {
    id: "whisper-tiny",
    label: "Whisper tiny (int8) — только для тестов, низкое качество",
    url: RELEASE + "sherpa-onnx-whisper-tiny.tar.bz2",
    archive: "tar.bz2",
    downloadMb: 116,
    files: {
      "tiny-encoder.int8.onnx": "d24fb083ae3b1041fc24e97971d60e280c9342201fbb67b0ab428a8b4a51a434",
      "tiny-decoder.int8.onnx": "d2fece8dd42771f1df975c6c0445770d0c292bf7547c2cae04a6c0cc57540925",
      "tiny-tokens.txt": "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
    },
  },
  "silero-vad": {
    id: "silero-vad",
    label: "Silero VAD — поиск фраз и пауз",
    url: RELEASE + "silero_vad.onnx",
    archive: "file",
    downloadMb: 1,
    files: { "silero_vad.onnx": "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6" },
  },
  // MediaPipe (Apache-2.0), versioned URLs on Google storage (default allow-list of Claude Code cloud).
  "mp-face-landmarker": {
    id: "mp-face-landmarker",
    label: "MediaPipe Face Landmarker — лицо, глаза, рот, подбородок",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    archive: "file",
    downloadMb: 4,
    folder: "mediapipe",
    files: { "face_landmarker.task": "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff" },
  },
  "mp-selfie-multiclass": {
    id: "mp-selfie-multiclass",
    label: "MediaPipe Selfie Multiclass — силуэт, волосы, лицо",
    url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
    archive: "file",
    downloadMb: 16,
    folder: "mediapipe",
    files: { "selfie_multiclass.tflite": "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0" },
  },
};

export function modelDir(modelsRoot: string, id: ModelId): string {
  const f = MODELS[id].folder;
  return f ? join(modelsRoot, f) : join(modelsRoot, "speech", id);
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
}

export async function verifyModel(modelsRoot: string, id: ModelId): Promise<boolean> {
  const dir = modelDir(modelsRoot, id);
  const marker = join(dir, `.verified-${id}`);
  if (existsSync(marker)) return true;
  for (const [f, hash] of Object.entries(MODELS[id].files)) {
    const p = join(dir, f);
    if (!existsSync(p) || (await sha256(p)) !== hash) return false;
  }
  writeFileSync(marker, new Date().toISOString());
  return true;
}

/** Download (if needed), unpack and verify a model. Returns its folder. */
export async function ensureModel(modelsRoot: string, id: ModelId, log: (s: string) => void = () => {}): Promise<string> {
  const spec = MODELS[id];
  const dir = modelDir(modelsRoot, id);
  if (await verifyModel(modelsRoot, id)) return dir;

  log(`Загрузка модели: ${spec.label} (~${spec.downloadMb} МБ, один раз на сессию)…`);
  if (!MODELS[id].folder) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${id}.part`);
  const res = await fetch(spec.url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(
      `Не удалось скачать модель (HTTP ${res.status}). Нужен доступ к загрузкам релизов GitHub ` +
        "(github.com, release-assets.githubusercontent.com — разрешены в стандартной сети Claude Code). " +
        "Альтернатива: импорт текста с таймкодами (SRT/VTT).",
    );
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));

  if (spec.archive === "tar.bz2") {
    // Archives contain one top-level folder; strip it.
    await run("tar", ["-xjf", tmp, "-C", dir, "--strip-components=1", "--wildcards", ...Object.keys(spec.files).map((f) => `*/${f}`)]);
    rmSync(tmp);
  } else {
    renameSync(tmp, join(dir, Object.keys(spec.files)[0]!));
  }
  if (!(await verifyModel(modelsRoot, id))) {
    for (const f of Object.keys(spec.files)) rmSync(join(dir, f), { force: true });
    throw new Error(`Контрольная сумма модели ${id} не совпала — файл повреждён или подменён. Загрузка отменена.`);
  }
  log(`Модель ${id} готова и проверена (SHA-256).`);
  return dir;
}
