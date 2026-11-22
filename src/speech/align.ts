import { splitWords, type Segment, type Transcript, type Word } from "./transcript";

export function normWord(w: string): string {
  return w.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** 0..1 similarity of two words (1 = identical after normalisation). */
export function similarity(a: string, b: string): number {
  const x = normWord(a);
  const y = normWord(b);
  if (!x && !y) return 1;
  return 1 - lev(x, y) / Math.max(x.length, y.length, 1);
}

/**
 * Global word alignment (Needleman–Wunsch) of recognised words to script words.
 * Returns for each script word the index of the matched recognised word, or -1.
 */
export function alignWords(asr: string[], script: string[]): number[] {
  const n = asr.length;
  const m = script.length;
  const GAP = 0.6;
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const back: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) (score[i]![0] = -i * GAP), (back[i]![0] = 1);
  for (let j = 1; j <= m; j++) (score[0]![j] = -j * GAP), (back[0]![j] = 2);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = similarity(asr[i - 1]!, script[j - 1]!);
      const diag = score[i - 1]![j - 1]! + (sim * 2 - 1);
      const up = score[i - 1]![j]! - GAP;
      const left = score[i]![j - 1]! - GAP;
      const best = Math.max(diag, up, left);
      score[i]![j] = best;
      back[i]![j] = best === diag ? 0 : best === up ? 1 : 2;
    }
  }
  const match = new Array<number>(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const b = i > 0 && j > 0 ? back[i]![j]! : i > 0 ? 1 : 2;
    if (b === 0) {
      if (similarity(asr[i - 1]!, script[j - 1]!) >= 0.34) match[j - 1] = i - 1;
      i--, j--;
    } else if (b === 1) i--;
    else j--;
  }
  return match;
}

/**
 * Maps between wall-clock time and "speech time" (only the measured voice phrases, pauses removed).
 * Unmatched script words are spread over speech time, so they never land inside a pause.
 */
export class SpeechTimeline {
  private spans: Array<{ start: number; end: number; acc: number }> = [];
  readonly total: number;
  constructor(phrases: Array<{ startMs: number; endMs: number }>) {
    let acc = 0;
    for (const p of phrases) {
      if (p.endMs <= p.startMs) continue;
      this.spans.push({ start: p.startMs, end: p.endMs, acc });
      acc += p.endMs - p.startMs;
    }
    this.total = acc;
  }
  toSpeech(ms: number): number {
    for (const s of this.spans) {
      if (ms < s.start) return s.acc;
      if (ms <= s.end) return s.acc + (ms - s.start);
    }
    return this.total;
  }
  /** `asStart`: a moment exactly at a phrase boundary belongs to the NEXT phrase. */
  toWall(sp: number, asStart = false): number {
    for (const s of this.spans) {
      const endAcc = s.acc + (s.end - s.start);
      if (asStart ? sp < endAcc : sp <= endAcc) return s.start + Math.max(0, sp - s.acc);
    }
    const last = this.spans.at(-1);
    return last ? last.end : 0;
  }
}

const weight = (w: string) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,!?;:…]$/.test(w) ? 2 : 0);

/**
 * Use the user's script as the exact caption text; timing comes from the audio.
 * - Good match (≥ 50 % of words recognised): recognised words are anchors, the rest is spread
 *   between anchors over speech time, weighted by word length.
 * - Poor match (e.g. weak Kazakh recognition): anchors are unreliable, so all words are spread
 *   over the measured speech phrases by length.
 */
export function alignScript(t: Transcript, scriptText: string): { transcript: Transcript; matchRatio: number } {
  const phrases = t.segments.filter((s) => s.endMs > s.startMs);
  const scriptWords = splitWords(scriptText);
  if (phrases.length === 0 || scriptWords.length === 0) throw new Error("Нечего выравнивать: пустой текст или не найдено речи.");
  const tl = new SpeechTimeline(phrases);
  const asrWords: Word[] = t.segments.flatMap((s) => s.words);
  const match = asrWords.length ? alignWords(asrWords.map((w) => w.text), scriptWords) : scriptWords.map(() => -1);
  const matchRatio = match.filter((x) => x >= 0).length / scriptWords.length;
  const useAnchors = matchRatio >= 0.5;

  // Speech-time start/end per script word.
  const st = new Array<number | null>(scriptWords.length).fill(null);
  const en = new Array<number | null>(scriptWords.length).fill(null);
  if (useAnchors) {
    match.forEach((k, j) => {
      if (k >= 0) (st[j] = tl.toSpeech(asrWords[k]!.startMs)), (en[j] = tl.toSpeech(asrWords[k]!.endMs));
    });
  }
  let j = 0;
  while (j < scriptWords.length) {
    if (st[j] !== null) {
      j++;
      continue;
    }
    let k = j;
    while (k < scriptWords.length && st[k] === null) k++;
    const from = j > 0 ? en[j - 1]! : 0;
    const to = k < scriptWords.length ? st[k]! : tl.total;
    const ws = scriptWords.slice(j, k).map(weight);
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    let cur = from;
    for (let x = j; x < k; x++) {
      const d = (Math.max(0, to - from) * ws[x - j]!) / sum;
      st[x] = cur;
      en[x] = cur + d;
      cur += d;
    }
    j = k;
  }

  const words: Word[] = scriptWords.map((w, x) => {
    const a = Math.round(tl.toWall(st[x]!, true));
    // A word that crosses a pause ends at the end of its phrase.
    const b = Math.round(tl.toWall(Math.max(st[x]!, en[x]! - 0.5)));
    return { text: w, startMs: a, endMs: Math.max(a + 1, b) };
  });
  const segments: Segment[] = phrases.map((s) => ({ startMs: s.startMs, endMs: s.endMs, words: [] as Word[], text: "" }));
  for (const w of words) {
    let idx = segments.findIndex((s) => w.startMs < s.endMs);
    if (idx < 0) idx = segments.length - 1;
    segments[idx]!.words.push(w);
  }
  const filled = segments.filter((s) => s.words.length > 0).map((s) => ({ ...s, text: s.words.map((w) => w.text).join(" ") }));
  const notes = [
    ...t.notes,
    useAnchors
      ? `Текст субтитров взят из сценария; совпадение с распознанной речью ${Math.round(matchRatio * 100)}%, тайминг — по словам и паузам записи.`
      : `Текст субтитров взят из сценария; распознавание слабое (${Math.round(matchRatio * 100)}%), поэтому слова распределены по фразам записи пропорционально длине — проверьте тайминг в сториборде.`,
  ];
  return {
    matchRatio,
    transcript: { ...t, source: "script-aligned", needsReview: !useAnchors || matchRatio < 0.8, notes, segments: filled },
  };
}
