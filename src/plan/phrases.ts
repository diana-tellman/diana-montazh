/** Caption phrasing: turn timed words into short readable phrases split into balanced lines. */
export type TWord = { text: string; start: number; end: number; emphasis: boolean };

export type PhraseRules = {
  maxWords: number;
  maxChars: number;
  /** A pause at least this long always ends a phrase (seconds). */
  pause: number;
  /** Phrases shorter than this are merged with a neighbour (seconds). */
  minDur: number;
};

const ENDS = /[.!?…]$/;
const SOFT = /[,;:—–-]$/;
const len = (ws: TWord[]) => ws.reduce((n, w) => n + w.text.length, 0) + Math.max(0, ws.length - 1);

/** `*слово*` in the user's script marks an emphasis word. Numbers are emphasised automatically. */
export function parseEmphasis(raw: string): { text: string; emphasis: boolean } {
  const m = raw.match(/^([«"(]*)\*(.+?)\*([»".,!?:;)…]*)$/u);
  if (m) return { text: `${m[1]}${m[2]}${m[3]}`, emphasis: true };
  return { text: raw, emphasis: /\d/.test(raw) };
}

export function groupPhrases(words: TWord[], r: PhraseRules): TWord[][] {
  const out: TWord[][] = [];
  let cur: TWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    cur.push(w);
    const gap = next ? next.start - w.end : Infinity;
    const full = cur.length >= r.maxWords || len(cur) + (next ? next.text.length + 1 : 0) > r.maxChars;
    if (!next || gap >= r.pause || ENDS.test(w.text) || full || (SOFT.test(w.text) && cur.length >= 2)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);

  // Merge an orphan single short word and too-short phrases into a neighbour when it still fits.
  const merged: TWord[][] = [];
  for (const p of out) {
    const prev = merged.at(-1);
    const dur = p.at(-1)!.end - p[0]!.start;
    const tiny = (p.length === 1 && p[0]!.text.length <= 4) || dur < r.minDur;
    if (prev && tiny && !ENDS.test(prev.at(-1)!.text) && prev.length + p.length <= r.maxWords + 1 && len(prev) + len(p) + 1 <= r.maxChars + 6 && p[0]!.start - prev.at(-1)!.end < r.pause) {
      prev.push(...p);
    } else merged.push([...p]);
  }
  return merged;
}

/** Split a phrase into 1–2 lines with balanced character counts. */
export function splitLines(words: TWord[], maxCharsPerLine: number): TWord[][] {
  if (len(words) <= maxCharsPerLine || words.length < 2) return [words];
  let best = 1;
  let bestDiff = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = len(words.slice(0, k));
    const b = len(words.slice(k));
    // Prefer the first line slightly shorter (pyramid reads better), avoid 1-word second line.
    const diff = Math.abs(a - b) + (words.length - k === 1 ? 4 : 0) + (a > b ? 1 : 0);
    if (diff < bestDiff) (bestDiff = diff), (best = k);
  }
  return [words.slice(0, best), words.slice(best)];
}
