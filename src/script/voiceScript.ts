/**
 * Script for the user's OWN voice recording (never TTS): when an animation / explainer needs narration
 * and the user has none, Claude writes the text, the user reads it into the phone and sends the audio.
 * This module estimates reading time and lays the text out for reading from the phone screen.
 */
export type Lang = "kk" | "ru" | "en";

/** Calm, clear speaking rate for social video (words per second). Kazakh words are longer. */
export const WORDS_PER_SEC: Record<Lang, number> = { kk: 1.9, ru: 2.2, en: 2.5 };

export type ScriptBlock = { index: number; text: string; words: number; seconds: number; from: number; to: number };

const clean = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
export const countWords = (s: string) => clean(s).split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Split into blocks (paragraphs; long paragraphs by sentence) with estimated timing incl. a 0.4 s pause between blocks. */
export function scriptBlocks(text: string, lang: Lang): ScriptBlock[] {
  const paras = text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const p of paras) {
    if (countWords(p) <= 28) parts.push(p);
    else {
      let cur = "";
      for (const s of p.split(/(?<=[.!?…])\s+/)) {
        if (cur && countWords(cur + " " + s) > 28) (parts.push(cur), (cur = s));
        else cur = (cur + " " + s).trim();
      }
      if (cur) parts.push(cur);
    }
  }
  let t = 0;
  return parts.map((p, i) => {
    const words = countWords(p);
    const seconds = Math.round((words / WORDS_PER_SEC[lang]) * 10) / 10;
    const b = { index: i + 1, text: p, words, seconds, from: Math.round(t * 10) / 10, to: Math.round((t + seconds) * 10) / 10 };
    t += seconds + 0.4;
    return b;
  });
}

/** How many words fit a target duration (for writing a script of the right length). */
export const wordsFor = (seconds: number, lang: Lang) => Math.round(seconds * WORDS_PER_SEC[lang]);

const HOW: Record<Lang, string> = {
  kk: "**Қалай жазу керек:** тыныш бөлмеде, телефонды аузыңнан 20–30 см ұста. Диктофон (немесе видео) қосып, мәтінді асықпай оқы. Блоктар арасында 1 секунд үзіліс жаса. Қателессең — сол сөйлемді қайта оқы, артығын өзім кесемін. Дайын болса, файлды (M4A / MP3 / WAV немесе видео) осы чатқа жібер.",
  ru: "**Как записать:** в тихой комнате, телефон в 20–30 см ото рта. Включите диктофон (или видео) и читайте спокойно. Между блоками — пауза 1 секунда. Ошиблись — перечитайте предложение, лишнее я вырежу. Пришлите файл (M4A / MP3 / WAV или видео) в этот чат.",
  en: "**How to record:** quiet room, phone 20–30 cm from your mouth. Start Voice Memos (or video) and read calmly, 1 s pause between blocks. If you slip, just reread the sentence — I will cut the extra. Send the file (M4A / MP3 / WAV or video) here.",
};

/** Phone-friendly markdown: numbered blocks, timing, accents bold, recording instructions. */
export function scriptMarkdown(title: string, text: string, lang: Lang): string {
  const blocks = scriptBlocks(text, lang);
  const total = blocks.at(-1)?.to ?? 0;
  const head = lang === "kk" ? `# Дауыс мәтіні: ${title}\nШамамен **${Math.round(total)} секунд** · ${blocks.reduce((a, b) => a + b.words, 0)} сөз. **Жуан** сөздерді сәл екпінмен айт.` : `# ${title}\n≈ **${Math.round(total)} s** · ${blocks.reduce((a, b) => a + b.words, 0)} words. Stress the **bold** words a little.`;
  const body = blocks.map((b) => `**${b.index}.** _(${b.from.toFixed(0)}–${b.to.toFixed(0)} с)_\n${b.text.replace(/\*([^*]+)\*/g, "**$1**")}`).join("\n\n");
  return `${head}\n\n${body}\n\n---\n${HOW[lang]}\n`;
}
