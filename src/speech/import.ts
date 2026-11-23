import { estimateWords, type Segment, type Transcript } from "./transcript";

/** "00:01:02,500" | "01:02.5" | "1:02" | "62.5" → ms */
export function parseTimecode(tc: string): number {
  const s = tc.trim().replace(",", ".");
  const parts = s.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) throw new Error(`Неверный таймкод: ${tc}`);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return Math.round(sec * 1000);
}

const TC = String.raw`(\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?`;

/** SRT and WebVTT cues. */
export function parseSubtitles(text: string): Segment[] {
  const re = new RegExp(`(${TC})\\s*-->\\s*(${TC})[^\\n]*\\n([\\s\\S]*?)(?:\\n\\s*\\n|$)`, "g");
  const out: Segment[] = [];
  for (const m of text.replace(/\r/g, "").matchAll(re)) {
    const startMs = parseTimecode(m[1]!);
    const endMs = parseTimecode(m[3]!);
    const body = m[5]!.replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
    if (body && endMs > startMs) out.push({ startMs, endMs, text: body, words: estimateWords(body, startMs, endMs) });
  }
  return out;
}

/**
 * Plain text where each line starts with a timecode:
 *   0:00 Сәлеметсіз бе!
 *   [0:03.5] Бүгін монтаж туралы
 * A line ends where the next one starts; the last ends at `durationMs`.
 */
export function parseTimecodedLines(text: string, durationMs: number): Segment[] {
  const re = new RegExp(`^\\s*\\[?(${TC}|\\d+(?:[.,]\\d+)?)\\]?\\s*[-–—]?\\s*(.+)$`);
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.match(re))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ startMs: parseTimecode(m[1]!), text: m[3]!.trim() }));
  return rows.map((r, i) => {
    const endMs = rows[i + 1]?.startMs ?? durationMs;
    return { startMs: r.startMs, endMs, text: r.text, words: estimateWords(r.text, r.startMs, endMs) };
  });
}

export function importTranscript(fileText: string, durationMs: number): Transcript {
  const isSubs = /-->/.test(fileText);
  const segments = isSubs ? parseSubtitles(fileText) : parseTimecodedLines(fileText, durationMs);
  if (segments.length === 0) throw new Error("В файле не найдено ни одной строки с таймкодом (SRT, VTT или «0:00 текст»).");
  return {
    version: 1,
    source: "import",
    model: null,
    language: null,
    durationMs,
    timing: { segments: "imported", words: "estimated" },
    needsReview: false,
    notes: [isSubs ? "Импортированы субтитры SRT/VTT." : "Импортирован текст с таймкодами."],
    segments,
  };
}
