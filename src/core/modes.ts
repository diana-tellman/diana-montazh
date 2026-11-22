import type { Mode } from "./project";

export type MaterialSummary = {
  /** Videos with a flag whether they contain sustained voice-level sound. */
  videos: Array<{ name: string; speechLikely: boolean | null }>;
  /** Separate audio recordings (MP3 / M4A / WAV / …). */
  audios: string[];
  photos: string[];
  hasScript: boolean;
};

export type ModeDecision =
  | { kind: "decided"; mode: Mode; voiceSource: string; reason: string }
  | { kind: "ask"; question: string; reason: string };

const UPLOAD_VOICE =
  "Загрузите, пожалуйста, свою голосовую запись (MP3, M4A или WAV) — она станет озвучкой видео. / " +
  "Видеоның дыбысы болатын өз дауыс жазбаңызды жүктеңіз (MP3, M4A немесе WAV).";

/**
 * Decide the production mode from the uploaded material.
 * The narration is always the user's own recording; when it is unclear
 * which recording is the voice, the user is asked — never guessed.
 */
export function detectMode(m: MaterialSummary): ModeDecision {
  const speaking = m.videos.filter((v) => v.speechLikely === true);

  if (m.audios.length > 1) {
    return {
      kind: "ask",
      reason: "Загружено несколько аудиозаписей.",
      question: `Какая запись — основная озвучка: ${m.audios.join(", ")}? Или склеить их по порядку? / Қай жазба негізгі дыбыс болады?`,
    };
  }

  if (m.audios.length === 1) {
    const audio = m.audios[0]!;
    if (speaking.length > 0) {
      return {
        kind: "ask",
        reason: "Есть и отдельная аудиозапись, и видео с речью.",
        question:
          `Что использовать как голос видео: отдельную запись «${audio}» или речь из видео (${speaking.map((v) => v.name).join(", ")})? / ` +
          "Видеодағы сөзді қолданамыз ба, әлде бөлек аудиожазбаны ма?",
      };
    }
    return {
      kind: "decided",
      mode: "voice-over-visuals",
      voiceSource: audio,
      reason:
        m.videos.length + m.photos.length > 0
          ? "Ваша аудиозапись — озвучка, фото и видео — визуальный ряд."
          : "Ваша аудиозапись — озвучка, визуальный ряд — анимационная графика.",
    };
  }

  if (speaking.length > 0) {
    return {
      kind: "decided",
      mode: "expert-video",
      voiceSource: speaking.map((v) => v.name).join(", "),
      reason: "Видео с вашей речью: оригинальный голос сохраняется.",
    };
  }

  if (m.videos.length > 0) {
    return {
      kind: "ask",
      reason: "В видео не обнаружена речь (или звука нет).",
      question: `В загруженном видео не слышно речи. ${UPLOAD_VOICE}`,
    };
  }

  if (m.photos.length > 0 || m.hasScript) {
    return { kind: "ask", reason: "Нет голосовой записи.", question: UPLOAD_VOICE };
  }

  return {
    kind: "ask",
    reason: "Материалы не загружены.",
    question: "Загрузите видео, фото или аудиозапись своего голоса. / Видео, фото немесе өз дауысыңыздың жазбасын жүктеңіз.",
  };
}
