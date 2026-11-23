/**
 * Own line-icon set (24×24, stroke-drawn) + keyword dictionary (kk / ru / en).
 * Icons appear when the speaker says a matching word ("видеоға сәйкес").
 */
export const ICONS: Record<string, string[]> = {
  phone: ["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M11 18h2"],
  money: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 6.5v11", "M15 9.3c0-1.3-1.3-2.3-3-2.3s-3 1-3 2.2 1.3 1.9 3 2.1 3 .9 3 2.3-1.3 2.2-3 2.2-3-1-3-2.4"],
  clock: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 7v5l3.5 2"],
  idea: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.5 1 2.5h6c0-1 .4-1.9 1-2.5A6 6 0 0 0 12 3z"],
  check: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M8 12.5l3 3 5-6"],
  heart: ["M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"],
  star: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"],
  growth: ["M3 20h18", "M5 16l5-5 4 3 6-7", "M15 7h5v5"],
  video: ["M3 7h12v10H3z", "M15 10.5l6-3.5v10l-6-3.5"],
  chat: ["M4 5h16v10H9l-5 4z", "M8 9h8", "M8 12h5"],
  bell: ["M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z", "M10 20.5a2 2 0 0 0 4 0"],
  warning: ["M12 3l10 18H2z", "M12 10v5", "M12 18.2v.1"],
  fire: ["M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 2 1 4 4 4 6 1-1 1.5-2 1.5-3 2 2 2.5 4 2.5 7 0 3-2 6-6 6z"],
  target: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z", "M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z"],
  book: ["M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z", "M4 19V5", "M8 7h7"],
  gift: ["M4 10h16v10H4z", "M3 7h18v3H3z", "M12 7v13", "M12 7c-2-4-6-3-4 0", "M12 7c2-4 6-3 4 0"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z"],
};

/** Stems (prefix match, lower-case). Order matters: first match wins. */
const KEYWORDS: Array<[string, string[]]> = [
  ["bell", ["жазылыңыз", "жазылу", "жазылып", "подпис", "subscrib", "follow"]],
  ["phone", ["телефон", "смартфон", "айфон", "iphone", "phone"]],
  ["money", ["ақша", "табыс", "пайда", "теңге", "доллар", "деньг", "доход", "заработ", "прибыл", "money", "income", "profit", "salary"]],
  ["clock", ["уақыт", "минут", "сағат", "секунд", "жылдам", "время", "минут", "час", "быстр", "time", "minute", "hour", "fast"]],
  ["idea", ["идея", "кеңес", "лайфхак", "совет", "idea", "tip"]],
  ["check", ["дайын", "дұрыс", "готов", "правильн", "done", "correct", "ready"]],
  ["heart", ["махаббат", "ұнат", "любл", "люби", "любов", "нрав", "лайк", "love", "like"]],
  ["star", ["үздік", "мықты", "лучш", "best"]],
  ["growth", ["өсу", "өсім", "нәтиже", "результат", "рост", "growth", "result"]],
  ["video", ["видео", "түсір", "кадр", "камера", "съём", "сним", "монтаж", "рилс", "reels", "video", "film", "record"]],
  ["chat", ["коммент", "пікір", "сұрақ", "вопрос", "comment", "question"]],
  ["warning", ["қате", "абай", "назар", "маңызды", "ошибк", "внимани", "важн", "mistake", "warning", "important"]],
  ["fire", ["тренд", "хит", "вирус", "trend", "viral"]],
  ["target", ["мақсат", "жүйе", "цель", "систем", "goal", "target", "system"]],
  ["book", ["сабақ", "курс", "оқу", "үйрен", "урок", "учеб", "обуч", "lesson", "course", "learn"]],
  ["gift", ["сыйлық", "бонус", "тегін", "подар", "бесплат", "gift", "bonus", "free"]],
  ["link", ["сілтеме", "ссылк", "link"]],
  ["eye", ["көрермен", "просмотр", "view"]],
];

export function iconForWord(word: string): string | null {
  const w = word.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
  if (w.length < 3) return null;
  for (const [icon, stems] of KEYWORDS) if (stems.some((s) => w.startsWith(s))) return icon;
  return null;
}
