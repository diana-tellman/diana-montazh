import type { Mode } from "./project";

export type ModeInputs = {
  /** The user's own words (request), in kk / ru / en. */
  request: string;
  hasVideo: boolean;
  hasAudioOnly: boolean;
  hasScript: boolean;
  /** Result of speech-activity analysis of the uploaded media, if any. */
  speechLikely: boolean | null;
};

export type ModeDecision =
  | { kind: "decided"; mode: Mode; reason: string; keepOriginalVoice: boolean }
  | { kind: "ask"; question: string; options: Mode[]; reason: string };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Phrases that mean "use a narrator / synthetic voice". */
const NARRATOR = [
  "диктор", "озвуч", "закадров", "синтез", "tts", "voiceover", "voice over", "narrator", "narration",
  "дыбыстап", "дауыстап", "диктор дауыс", "жасанды дауыс",
];
/** Phrases that mean "keep my own voice". */
const KEEP_OWN = [
  "мой голос", "моим голосом", "своим голосом", "свой голос", "оригинальн", "сохрани голос",
  "my voice", "own voice", "original voice", "менің дауыс", "өз дауыс", "дауысымды сақта", "дауысым",
];
/** Explicit request to make a video from text only. */
const FROM_TEXT = [
  "по тексту", "по сценарию", "из текста", "из сценария", "from text", "from script", "мәтін бойынша", "сценарий бойынша", "мәтіннен",
];

const hasAny = (text: string, list: string[]) => list.some((w) => text.includes(w));

/**
 * Decide the production mode from the request and the uploaded material.
 * Never silently replaces a real person's voice: any conflict between
 * "own recording" and "narrator" becomes a question to the user.
 */
export function detectMode(input: ModeInputs): ModeDecision {
  const t = norm(input.request);
  const wantsNarrator = hasAny(t, NARRATOR);
  const wantsOwn = hasAny(t, KEEP_OWN);
  const wantsFromText = hasAny(t, FROM_TEXT);

  const askVoice = (reason: string, own: Mode): ModeDecision => ({
    kind: "ask",
    reason,
    options: [own, "text-to-video"],
    question:
      "Сохранить ваш оригинальный голос из записи или сделать дикторскую озвучку по тексту? / " +
      "Жазбадағы өз дауысыңызды сақтаймыз ба, әлде мәтін бойынша диктор дауысын жасаймыз ба?",
  });

  if (input.hasVideo) {
    if (wantsNarrator && !wantsOwn) {
      return askVoice("Есть собственное видео, но в запросе упомянута озвучка/диктор.", "expert-video");
    }
    if (input.speechLikely === false && !wantsOwn) {
      return askVoice("В видео не обнаружена речь — непонятно, нужен ли диктор.", "expert-video");
    }
    return {
      kind: "decided",
      mode: "expert-video",
      keepOriginalVoice: true,
      reason: "Загружено собственное видео с речью: сохраняем оригинальный голос.",
    };
  }

  if (input.hasAudioOnly) {
    if (wantsNarrator && !wantsOwn) {
      return askVoice("Есть собственная аудиозапись, но в запросе упомянута озвучка/диктор.", "audio-to-video");
    }
    return {
      kind: "decided",
      mode: "audio-to-video",
      keepOriginalVoice: true,
      reason: "Загружена аудиозапись без видео: анимация под оригинальный голос.",
    };
  }

  if (input.hasScript || wantsFromText || wantsNarrator) {
    return {
      kind: "decided",
      mode: "text-to-video",
      keepOriginalVoice: false,
      reason: "Нет собственной записи: видео по тексту с дикторской озвучкой (TTS или загруженная озвучка).",
    };
  }

  return {
    kind: "ask",
    reason: "Не передано ни видео, ни аудио, ни текст.",
    options: ["expert-video", "text-to-video", "audio-to-video"],
    question:
      "Пришлите видео, аудиозапись или текст сценария. / Видео, аудиожазба немесе сценарий мәтінін жіберіңіз.",
  };
}
