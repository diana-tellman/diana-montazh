/**
 * Catalogue of stock narrator voices. These are generic voices trained on
 * public datasets — not clones of any real person chosen by the user.
 * Voice cloning (making a voice from someone's recording) is NOT supported.
 */
export type Lang = "kk" | "ru" | "en";

export type VoiceEntry = {
  id: string;
  provider: "piper" | "espeak-draft";
  language: Lang;
  label: string;
  /** "draft" voices are for timing previews only; not for the final video unless the user accepts. */
  quality: "draft" | "x_low" | "low" | "medium" | "high";
  /** Piper: path of the model on Hugging Face (rhasspy/piper-voices). */
  hfPath?: string;
  /**
   * Licence of the voice must be read from its MODEL_CARD when downloaded.
   * Until then it is unknown — the system says so instead of guessing.
   */
  licenseNote: string;
};

const piper = (id: string, language: Lang, label: string, quality: VoiceEntry["quality"]): VoiceEntry => {
  const [locale, name, q] = id.split("-") as [string, string, string];
  const family = locale.split("_")[0];
  return {
    id,
    provider: "piper",
    language,
    label,
    quality,
    hfPath: `${family}/${locale}/${name}/${q}/${id}.onnx`,
    licenseNote: "Проверяется по MODEL_CARD при скачивании модели.",
  };
};

export const VOICES: VoiceEntry[] = [
  piper("kk_KZ-issai-high", "kk", "Қазақ — ISSAI (high)", "high"),
  piper("kk_KZ-iseke-x_low", "kk", "Қазақ — Iseke (x_low)", "x_low"),
  piper("kk_KZ-raya-x_low", "kk", "Қазақ — Raya (x_low)", "x_low"),
  piper("ru_RU-irina-medium", "ru", "Русский — Irina", "medium"),
  piper("ru_RU-denis-medium", "ru", "Русский — Denis", "medium"),
  piper("ru_RU-dmitri-medium", "ru", "Русский — Dmitri", "medium"),
  piper("ru_RU-ruslan-medium", "ru", "Русский — Ruslan", "medium"),
  piper("en_US-lessac-medium", "en", "English (US) — Lessac", "medium"),
  piper("en_US-amy-medium", "en", "English (US) — Amy", "medium"),
  piper("en_GB-alba-medium", "en", "English (UK) — Alba", "medium"),
  { id: "espeak-kk", provider: "espeak-draft", language: "kk", label: "Қазақ — eSpeak (черновой)", quality: "draft", licenseNote: "eSpeak NG, GPL-3.0, синтетический голос." },
  { id: "espeak-ru", provider: "espeak-draft", language: "ru", label: "Русский — eSpeak (черновой)", quality: "draft", licenseNote: "eSpeak NG, GPL-3.0, синтетический голос." },
  { id: "espeak-en-us", provider: "espeak-draft", language: "en", label: "English — eSpeak (draft)", quality: "draft", licenseNote: "eSpeak NG, GPL-3.0, synthetic voice." },
];

export function findVoice(id: string): VoiceEntry | undefined {
  return VOICES.find((v) => v.id === id);
}

export function voicesFor(language: Lang): VoiceEntry[] {
  return VOICES.filter((v) => v.language === language);
}

export function piperUrl(v: VoiceEntry, file: "onnx" | "json" | "card"): string {
  if (!v.hfPath) throw new Error(`${v.id} is not a Piper voice`);
  const base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
  if (file === "onnx") return base + v.hfPath;
  if (file === "json") return base + v.hfPath + ".json";
  return base + v.hfPath.replace(/[^/]+$/, "MODEL_CARD");
}
