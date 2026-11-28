/**
 * Scene director: decides HOW each moment is framed from WHAT is being said.
 *
 *   emotion  → speaker full frame + slow push-in (face is the message)
 *   example  → speaker moves into a rounded / round window, the example takes the screen
 *   compare  → screen split in two: A-vs-B card on top, speaker below
 *   process  → speaker temporarily leaves the frame, full-screen explainer animation of the steps (voice continues)
 *   key      → glass plate with the key thought above the head
 *   cta      → call-to-action button
 *   question / neutral → speaker full frame
 *
 * Auto detection uses kk/ru/en marker words (deterministic, testable). Claude reviews the result
 * (work/beats.json) against the real meaning and may override it in storyboard/directions.json.
 */
import { z } from "zod";
import { iconForWord } from "../design/icons";
import type { Card, Intent } from "../storyboard/schema";
import type { TWord } from "./phrases";

export type DirectorBeat = {
  /** Phrase index range (inclusive). */
  p0: number;
  p1: number;
  intent: Intent;
  reason: string;
  /** Card content for example / compare / process. */
  card: Card | null;
  shape?: "rounded" | "circle";
  /** Key-thought / CTA plate text. */
  plate?: string;
  source: "auto" | "claude";
  /** Exact first/last spoken word (Claude's directions use exact times, not whole sentences). */
  w0?: TWord;
  w1?: TWord;
};

/** storyboard/directions.json — written by Claude after reading the transcript (times in seconds). */
export const DirectionsSchema = z.object({
  /** true: only these beats (auto detection off). false: these win, auto fills the rest. */
  replaceAuto: z.boolean().default(true),
  beats: z.array(
    z.object({
      start: z.number().nonnegative(),
      end: z.number().positive(),
      intent: z.enum(["emotion", "example", "compare", "process", "list", "number", "key", "cta", "question", "neutral"]),
      reason: z.string().default(""),
      title: z.string().optional(),
      /** Example keyword / two compared things / 2–4 steps — short (≤ 3 words each), the speaker's own words. */
      items: z.array(z.string()).max(6).optional(),
      /** Force a card look: flow (nodes + curves), orbit (centre + satellites), headline, counter… */
      variant: z.enum(["example", "compare", "steps", "flow", "orbit", "counter", "headline"]).optional(),
      shape: z.enum(["rounded", "circle"]).optional(),
      /** Plate text for key / cta. */
      plate: z.string().optional(),
    }),
  ),
});
export type Directions = z.infer<typeof DirectionsSchema>;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s?!-]/gu, " ").replace(/\s+/g, " ").trim();
const clean = (w: string) => w.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}-]/gu, "");

/** Marker stems (prefix match on a word) and phrases (substring match). */
const LEX: Record<Exclude<Intent, "question" | "neutral">, { stems: string[]; phrases: string[] }> = {
  list: {
    stems: ["түрлі", "әртүрлі", "тізім", "различн", "разные", "разных", "список", "various", "list", "types"],
    phrases: ["әр түрлі", "және тағы", "и многое другое", "and more"],
  },
  number: { stems: [], phrases: [] },
  cta: {
    stems: ["жазылыңыз", "жазылыңдар", "жазылың", "пікірге", "пікір жаз", "коммент", "сілтеме", "подпиш", "подписыв", "сохран", "поделит", "ссылк", "subscrib", "follow", "comment", "share"],
    phrases: ["жазылып ал", "жазылып қой", "сақтап ал", "сақтап қой", "бөлісіңіз", "досыңа жібер", "link in bio", "save this", "в профиле", "профильде"],
  },
  process: {
    stems: ["қадам", "біріншіден", "екіншіден", "үшіншіден", "алдымен", "сосын", "соңында", "ақырында", "процесс", "алгоритм", "нұсқаулық", "шаг", "сначала", "затем", "потом", "во-первых", "во-вторых", "в-третьих", "далее", "инструкц", "step", "steps", "firstly", "secondly", "then", "next", "finally", "process"],
    phrases: ["содан кейін", "одан кейін", "ең алдымен", "қалай жасау", "после этого", "в конце", "как сделать", "how to", "first of all", "after that"],
  },
  compare: {
    stems: ["салыстыр", "айырмашылы", "керісінше", "қарағанда", "сравн", "разниц", "отлич", "вместо", "versus", "vs", "compare", "difference", "instead"],
    phrases: ["емес,", "а не", "до и после", "бұрын мен қазір", "бұрын", "раньше", "было стало", "before and after", "rather than", "better than", "жақсырақ"],
  },
  example: {
    stems: ["мысалы", "мысалға", "мысал", "айталық", "мәселен", "например", "допустим", "кейс", "example", "instance"],
    phrases: ["к примеру", "скажем,", "for example", "for instance", "e g", "like this", "мысал ретінде", "вот пример"],
  },
  key: {
    stems: ["маңызды", "негізгі", "құпия", "главное", "важно", "важн", "запомн", "секрет", "important", "remember", "secret"],
    phrases: ["ең бастысы", "есте сақта", "есіңде болсын", "самое главное", "the key", "the main thing"],
  },
  emotion: {
    stems: ["керемет", "ғажап", "таңғал", "таң қал", "қорық", "бақыт", "қуан", "жыла", "шынымен", "сенбейсің", "өкін", "ұял", "ашулан", "шаршадым", "уау", "вау", "невероятн", "потрясающ", "обожа", "ненавиж", "страшн", "боюсь", "счастл", "кайф", "офиген", "серьезно", "честно", "amazing", "incredible", "hate", "scared", "wow", "honestly", "crazy", "insane"],
    phrases: ["жақсы көремін", "жүрегім", "мен сондай", "я так", "до слёз", "i love", "i was so"],
  },
};

/** Words that carry no content on a card (markers, conjunctions, pronouns). */
const STOP = new Set(
  (
    "және мен да де та те бен пен ал бірақ немесе егер сосын содан кейін одан алдымен біріншіден екіншіден үшіншіден соңында ақырында мысалы мысалға мысал айталық мәселен " +
    "ба бе ма ме па пе деп дейді дейсің ойлайсың ойлаймын думаешь думаю think онда мұнда сонда осында бастысы басты маңыздысы бұл осы сол ол біз сіз сен мен менің сенің оның бар жоқ емес керек болады болып еді деп деген үшін қалай не неге қандай қазір бұрын тек енді өте ең " +
    "главное важно и а но или если потом затем сначала далее во-первых во-вторых в-третьих например допустим это этот эта то тот как что чтобы для на в во с со к по из у о об же ли бы не нужно надо очень вот там тут сейчас раньше " +
    "and or but if then next first second finally for example the a an to of in on with is are was it this that you we i so just very now before after than vs versus instead"
  ).split(" "),
);

function matches(text: string, intent: keyof typeof LEX): string | null {
  const t = ` ${norm(text)} `;
  const raw = ` ${text.toLowerCase().replace(/ё/g, "е")} `;
  for (const ph of LEX[intent].phrases) if (raw.includes(ph) || t.includes(` ${ph} `)) return ph;
  for (const w of t.trim().split(" ")) for (const s of LEX[intent].stems) if (w.startsWith(s)) return s;
  return null;
}

/** Meaning of one phrase (priority order matters). */
export function classifyPhrase(text: string): { intent: Intent; marker: string | null } {
  for (const intent of ["cta", "process", "compare", "example", "list", "number", "key", "emotion"] as const) {
    if (intent === "list" && (text.match(/,/g) ?? []).length >= 2 && text.split(/\s+/).length >= 4) return { intent, marker: "," };
    if (intent === "number" && /\d/.test(text) && !/^\s*\d+[.)]\s/.test(text)) return { intent, marker: text.match(/\d[\d\s%]*/)![0].trim() };
    const m = matches(text, intent);
    if (m) {
      // "X емес" alone is a plain negation; compare needs "X емес, Y" with words after the comma.
      if (intent === "compare" && m === "емес," && !/емес,\s*\S+/u.test(text.toLowerCase())) continue;
      return { intent, marker: m };
    }
  }
  if (/!\s*$/.test(text.trim())) return { intent: "emotion", marker: "!" };
  if (/\?\s*$/.test(text.trim())) return { intent: "question", marker: "?" };
  return { intent: "neutral", marker: null };
}

/** Up to n content words of a word list → short card label. */
export function contentLabel(ws: TWord[], n = 3, keepMarkers = false): { text: string; at: number } | null {
  const c = ws.filter((w) => {
    const k = clean(w.text);
    return k.length >= 2 && !STOP.has(k) && (keepMarkers || !Object.values(LEX).some((l) => l.stems.some((s) => k.startsWith(s) && s.length >= 5)));
  });
  if (!c.length) return null;
  const pick = c.some((w) => w.emphasis) ? [c.find((w) => w.emphasis)!, ...c.filter((w) => !w.emphasis)].slice(0, n) : c.slice(0, n);
  pick.sort((a, b) => a.start - b.start);
  const text = pick.map((w) => w.text.replace(/^[«"(*]+|[»".,!?:;)*…]+$/gu, "")).join(" ");
  return { text, at: pick[0]!.start };
}

/** "3 000 подписчиков" → { value: 3000, prefix: "", suffix: "подписчиков" }; "60%" → { value: 60, suffix: "%" }. */
export function parseNumber(ws: TWord[]): { value: number; suffix: string; at: number; label: string } | null {
  for (let i = 0; i < ws.length; i++) {
    if (!/\d/.test(ws[i]!.text)) continue;
    let j = i;
    let digits = ws[i]!.text.replace(/[^\d%,.]/g, "");
    while (j + 1 < ws.length && /^\d{3}[.,!?]?$/.test(ws[j + 1]!.text)) digits += ws[++j]!.text.replace(/\D/g, "");
    const pct = digits.includes("%") || /^(пайыз|процент|percent)/i.test(ws[j + 1]?.text ?? "");
    const value = Number(digits.replace(/[^\d.,]/g, "").replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const unit = pct ? "%" : (ws[j + 1]?.text ?? "").replace(/[.,!?:;»"]+$/u, "");
    const label = ws.slice(0, i).map((w) => w.text).join(" ").replace(/[.,!?:;]+$/u, "");
    return { value, suffix: unit, at: ws[i]!.start, label };
  }
  return null;
}

/** Listing → items between commas / "және" (1–2 content words each). */
export function splitList(ws: TWord[]): Array<{ text: string; at: number }> {
  const parts: TWord[][] = [[]];
  for (const w of ws) {
    const k = clean(w.text);
    if (["және", "и", "and", "немесе", "или", "or"].includes(k)) {
      if (parts.at(-1)!.length) parts.push([]);
      continue;
    }
    parts.at(-1)!.push(w);
    if (/[,;]$/.test(w.text)) parts.push([]);
  }
  return parts.filter((p) => p.length).map((p) => contentLabel(p.slice(-2), 2)).filter((x): x is { text: string; at: number } => !!x).slice(0, 6);
}

/** Headline card from one phrase: small label / BIG keyword / script tail (reference poster typography). */
export function headlineCard(ws: TWord[], forced?: string): Card | null {
  const content = ws.filter((w) => { const k = clean(w.text); return k.length >= 3 && !STOP.has(k); });
  if (!content.length) return null;
  // Prefer the speaker's *emphasis*, then nouns/numbers over verb forms (kk/ru/en verb endings), then the longest word.
  const verb = (t: string) => /(мын|мін|быз|біз|сың|сің|сыз|сіз|ды|ді|ты|ті|ған|ген|қан|кен|йды|йді|йсың|йсің|ады|еді|ть|ешь|ете|ем|ют|ут|ит|ал|ла|ли|ing|ed)$/u.test(clean(t));
  const f = forced ? clean(forced.split(/\s+/)[0] ?? "") : "";
  const key = (f ? ws.find((w) => clean(w.text) === f) ?? ws.find((w) => clean(w.text).startsWith(f.slice(0, 5))) : undefined) ?? content.find((w) => w.emphasis) ?? [...content].sort((a, b) => Number(verb(a.text)) - Number(verb(b.text)) || b.text.length - a.text.length)[0]!;
  const i = ws.indexOf(key);
  const strip = (t: string) => t.replace(/^[«"(*]+|[»".,!?:;)*…—-]+$/gu, "");
  const before = ws.slice(Math.max(0, i - 4), i).map((w) => strip(w.text)).join(" ");
  const after = ws.slice(i + 1, i + 4).map((w) => strip(w.text)).join(" ");
  return { variant: "headline", title: "", label: before || undefined, script: after || undefined, items: [{ text: strip(key.text), icon: iconFor(ws.map((w) => w.text).join(" ")), at: key.start }] };
}

const iconFor = (text: string) => text.split(/\s+/).map(iconForWord).find(Boolean) ?? null;

/** Split a compare phrase into A / B around the connector ("X емес, Y", "X или Y", "X vs Y", "бұрын … қазір …"). */
export function splitCompare(ws: TWord[]): Array<{ text: string; at: number }> {
  const connectors = new Set(["емес", "немесе", "или", "vs", "versus", "or", "бірақ", "но", "but", "қазір", "сейчас", "now", "after", "после", "қарағанда", "чем", "than", "вместо", "instead", "а"]);
  for (let i = 1; i < ws.length - 1; i++) {
    const k = clean(ws[i]!.text);
    if (!connectors.has(k)) continue;
    // "X емес" → X belongs to A; "қарағанда" → A is before it too.
    const aWords = /емес|қарағанда/.test(k) ? ws.slice(0, i + 1) : ws.slice(0, i);
    const a = contentLabel(aWords.filter((w) => !/емес|қарағанда/.test(w.text.toLowerCase())), 2);
    const b = contentLabel(ws.slice(i + 1), 2);
    if (a && b) return [a, b];
  }
  const mid = Math.ceil(ws.length / 2);
  const a = contentLabel(ws.slice(0, mid), 2);
  const b = contentLabel(ws.slice(mid), 2);
  return a && b ? [a, b] : [];
}

/** Steps of a process: segments between sequence markers, else one step per phrase. */
export function extractSteps(phrases: TWord[][]): Array<{ text: string; at: number }> {
  const seq = /^(біріншіден|екіншіден|үшіншіден|төртіншіден|алдымен|сосын|кейін|соңында|ақырында|сначала|затем|потом|далее|во-первых|во-вторых|в-третьих|first|firstly|second|secondly|then|next|finally|\d+[.)]?)$/;
  const ws = phrases.flat();
  const marks = ws.map((w, i) => (seq.test(clean(w.text)) ? i : -1)).filter((i) => i >= 0);
  const out: Array<{ text: string; at: number }> = [];
  if (marks.length >= 2) {
    marks.forEach((m, k) => {
      const seg = ws.slice(m + 1, marks[k + 1] ?? ws.length);
      const l = contentLabel(seg, 3);
      if (l) out.push({ text: l.text, at: ws[m]!.start });
    });
  }
  if (out.length < 2) {
    out.length = 0;
    for (const p of phrases) {
      const l = contentLabel(p, 3);
      if (l) out.push(l);
    }
  }
  return out.slice(0, 4);
}

/** Meaning is read per SENTENCE (independent of how captions are cut: 1 word or 4). */
export function sentencePhrases(words: TWord[]): TWord[][] {
  const out: TWord[][] = [];
  let cur: TWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[.!?…]["»)]*$/.test(w.text) || next.start - w.end >= 0.7 || cur.length >= 14) {
      out.push(cur);
      cur = [];
    }
  });
  return out;
}

export type DirectorInput = {
  phrases: TWord[][];
  duration: number;
  /** Speaker video exists (layouts with a person are possible). */
  hasPerson: boolean;
};

const pStart = (p: TWord[]) => p[0]!.start;
const pEnd = (p: TWord[]) => p.at(-1)!.end;

/** Automatic meaning → beat detection with pacing rules (hook stays full frame, spacing, max share). */
export function autoBeats({ phrases, duration, hasPerson }: DirectorInput): DirectorBeat[] {
  // A phrase cut at a comma/dash ("Телефон емес," | "компьютер керек") is read together with the next one.
  const txt = phrases.map((p) => p.map((w) => w.text).join(" "));
  const cls = txt.map((t, i) => {
    const c = classifyPhrase(t);
    if (i + 1 < txt.length && /[,—–:-]\s*$/.test(t)) {
      const j = classifyPhrase(`${t} ${txt[i + 1]}`);
      if (j.intent !== c.intent && (j.intent === "compare" || c.intent === "neutral")) return j;
    }
    return c;
  });
  const withNext = (i: number) => (i + 1 < phrases.length && /[,—–:-]\s*$/.test(txt[i]!) ? [...phrases[i]!, ...phrases[i + 1]!] : phrases[i]!);
  const beats: DirectorBeat[] = [];
  let layoutTime = 0;
  let lastLayoutEnd = -Infinity;
  let lastKey = -Infinity;
  let lastPlateEnd = -Infinity;
  let shapeToggle = 0;
  for (let i = 0; i < phrases.length; i++) {
    const c = cls[i]!;
    const s = pStart(phrases[i]!);
    const layoutIntent = c.intent === "example" || c.intent === "compare" || c.intent === "process" || c.intent === "list";
    if (layoutIntent) {
      // Pacing rules protect the speaker's face time; without a speaker every moment may be a scheme.
      if (hasPerson && (s < 1.2 || s - lastLayoutEnd < 2 || s > duration - 1.5)) continue;
      // Extend over following phrases: at least ~2.4 s on screen; a process takes its steps (≤ 4 phrases, ≤ 9 s).
      let j = c.intent === "compare" && /[,—–:-]\s*$/.test(txt[i]!) ? Math.min(i + 1, phrases.length - 1) : i;
      const maxDur = c.intent === "process" ? 9 : 6.5;
      while (j + 1 < phrases.length) {
        const nextC = cls[j + 1]!;
        const dur = pEnd(phrases[j]!) - s;
        const next = pEnd(phrases[j + 1]!) - s;
        if (next > maxDur) break;
        if (c.intent === "process" ? j - i < 3 && (dur < 2.4 || nextC.intent === "process" || nextC.intent === "neutral") : dur < 2.4 && (nextC.intent === "neutral" || nextC.intent === c.intent)) j++;
        else break;
      }
      const dur = pEnd(phrases[j]!) - s;
      if (dur < 1.6 || (hasPerson && (layoutTime + dur) / duration > 0.5)) continue;
      const span = phrases.slice(i, j + 1);
      let card: Card | null = null;
      if (c.intent === "process") {
        const steps = extractSteps(span);
        if (steps.length < 2) continue;
        // Without a speaker: ≤ 3 steps read better as a flow of nodes joined by curves.
        card = { variant: !hasPerson && steps.length <= 3 ? "flow" : "steps", title: "", items: steps.map((x) => ({ text: x.text, icon: iconFor(x.text), at: x.at })) };
      } else if (c.intent === "list") {
        const items = splitList(span.flat());
        if (items.length < 3) continue;
        card = { variant: "orbit", title: "", items: items.map((x) => ({ text: x.text, icon: iconFor(x.text), at: x.at })) };
      } else if (c.intent === "compare") {
        const ab = splitCompare(span.flat());
        if (ab.length >= 2 && ab[0]!.text.toLowerCase() === ab[1]!.text.toLowerCase()) continue;
        if (ab.length < 2) continue;
        card = { variant: "compare", title: "", items: ab.map((x) => ({ text: x.text, icon: iconFor(x.text), at: x.at })) };
      } else {
        const markerIdx = span.flat().findIndex((w) => LEX.example.stems.some((st) => clean(w.text).startsWith(st)));
        const l = contentLabel(span.flat().slice(markerIdx + 1), 3) ?? contentLabel(span.flat(), 3);
        if (!l) continue;
        card = { variant: "example", title: "", items: [{ text: l.text, icon: iconFor(l.text), at: l.at }] };
      }
      const label = c.intent === "process" ? "процесс → спикер уақытша кадрдан шығады, толық экранды түсіндірме анимация" : c.intent === "compare" ? "салыстыру → экран екіге бөлінеді" : c.intent === "list" ? "тізім → орталық иконка мен айналасындағы элементтер (орбита)" : "мысал → спикер терезеге, мысал экранда";
      beats.push({ p0: i, p1: j, intent: hasPerson ? c.intent : c.intent, reason: `«${c.marker}» — ${label}`, card, shape: c.intent === "example" ? (shapeToggle++ % 2 ? "circle" : "rounded") : undefined, source: "auto" });
      layoutTime += dur;
      lastLayoutEnd = pEnd(phrases[j]!);
      i = j;
      continue;
    }
    if (c.intent === "number") {
      const n = parseNumber(withNext(i));
      if (n) beats.push({ p0: i, p1: i, intent: "number", reason: `«${c.marker}» — сан → үлкен санағыш (0 → ${n.value})`, card: { variant: "counter", title: "", label: n.label || undefined, value: n.value, suffix: n.suffix, items: [{ text: `${n.value}`, icon: null, at: n.at }] }, source: "auto" });
      continue;
    }
    if (c.intent === "emotion" && s >= 0.3) beats.push({ p0: i, p1: i, intent: "emotion", reason: `«${c.marker}» — эмоция → толық кадр, бетке жақындау`, card: null, source: "auto" });
    if ((c.intent === "cta" || (c.intent === "key" && s - lastKey >= 6)) && (c.intent === "cta" || s - lastPlateEnd >= 0.3)) {
      const span = withNext(i);
      const l = contentLabel(span, c.intent === "cta" ? 3 : 4, c.intent === "cta");
      if (!l) continue;
      const p1 = span.length > phrases[i]!.length ? i + 1 : i;
      beats.push({ p0: i, p1, intent: c.intent, reason: c.intent === "cta" ? `«${c.marker}» — әрекетке шақыру → батырма` : `«${c.marker}» — негізгі ой → шыны плашка`, card: null, plate: l.text, source: "auto" });
      if (c.intent === "key") lastKey = s;
      lastPlateEnd = pEnd(phrases[p1]!);
      i = p1;
    }
  }
  return beats;
}

/** Claude's directions (times) → beats on phrase boundaries; item times from the spoken words. */
export function directionsToBeats(d: Directions, phrases: TWord[][]): DirectorBeat[] {
  const out: DirectorBeat[] = [];
  for (const b of d.beats) {
    let p0 = phrases.findIndex((p) => pEnd(p) > b.start + 0.05);
    if (p0 < 0) continue;
    let p1 = p0;
    while (p1 + 1 < phrases.length && pStart(phrases[p1 + 1]!) < b.end - 0.1) p1++;
    if (pStart(phrases[p0]!) > b.end) continue;
    const all = phrases.slice(p0, p1 + 1).flat();
    const inside = all.filter((w) => w.start >= b.start - 0.15 && w.end <= b.end + 0.25);
    const ws = inside.length ? inside : all;
    const s = ws[0]!.start;
    const e = ws.at(-1)!.end;
    const at = (text: string, k: number, n: number) => {
      const first = clean(text.split(/\s+/)[0] ?? "");
      const hit = first.length >= 2 ? ws.find((w) => { const c = clean(w.text); return c.startsWith(first.slice(0, Math.max(3, Math.min(first.length, 5)))) || first.startsWith(c.slice(0, 5)); }) : undefined;
      return hit ? hit.start : s + ((e - s) * k) / Math.max(1, n);
    };
    let card: Card | null = null;
    if (b.intent === "number") {
      const n = parseNumber(ws);
      if (n) card = { variant: "counter", title: b.title ?? "", label: n.label || undefined, value: n.value, suffix: n.suffix, items: [{ text: `${n.value}`, icon: null, at: n.at }] };
    }
    if (b.intent === "list") {
      const items = b.items?.length ? b.items.map((t, k, arr) => ({ text: t, at: at(t, k, arr.length) })) : splitList(ws);
      card = { variant: "orbit", title: b.title ?? "", items: items.slice(0, 6).map((x) => ({ text: x.text, icon: iconFor(x.text), at: Math.max(s, x.at) })) };
    }
    if (b.intent === "example" || b.intent === "compare" || b.intent === "process") {
      const items = b.items?.length
        ? b.items.map((t, k, arr) => ({ text: t, at: at(t, k, arr.length) }))
        : b.intent === "process" ? extractSteps(phrases.slice(p0, p1 + 1)) : b.intent === "compare" ? splitCompare(ws) : [contentLabel(ws, 3)].filter((x): x is { text: string; at: number } => !!x);
      card = { variant: b.variant && b.variant !== "counter" && b.variant !== "headline" ? b.variant : b.intent === "process" ? "steps" : b.intent, title: b.title ?? "", items: items.slice(0, b.intent === "compare" ? 2 : 4).map((x) => ({ text: x.text, icon: iconFor(x.text), at: Math.max(s, x.at) })) };
    }
    if (!card && b.variant === "headline") card = headlineCard(ws, b.items?.[0]);
    out.push({ p0, p1, intent: b.intent, reason: b.reason || "Claude: мағынасы бойынша", card, shape: b.shape, plate: b.plate ?? (b.intent === "key" || b.intent === "cta" ? contentLabel(ws, 4)?.text : undefined), source: "claude", w0: ws[0], w1: ws.at(-1) });
  }
  return out;
}

/** Merge: Claude's beats win; auto beats fill only where they do not overlap (unless replaceAuto). */
export function mergeBeats(auto: DirectorBeat[], manual: DirectorBeat[], replaceAuto: boolean): DirectorBeat[] {
  if (replaceAuto) return [...manual].sort((a, b) => a.p0 - b.p0);
  const keep = auto.filter((a) => !manual.some((m) => a.p0 <= m.p1 && a.p1 >= m.p0));
  return [...manual, ...keep].sort((a, b) => a.p0 - b.p0);
}
