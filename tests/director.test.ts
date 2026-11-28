import { describe, expect, it } from "vitest";
import { autoBeats, classifyPhrase, directionsToBeats, DirectionsSchema, extractSteps, mergeBeats, splitCompare } from "../src/plan/director";
import type { TWord } from "../src/plan/phrases";
import { cardRect, personAt, personBox } from "../src/layout/person";
import { captionBand, insideSafe, safeZone } from "../src/layout/safeZones";
import { layoutStateAt, type Layout } from "../src/storyboard/schema";
import { speechSpans } from "../src/plan/planner";

/** Words with even timing from a sentence (0.35 s per word). */
function ws(text: string, t0: number): TWord[] {
  return text.split(" ").map((w, i) => ({ text: w, start: t0 + i * 0.35, end: t0 + i * 0.35 + 0.3, emphasis: false }));
}

describe("meaning of a phrase (kk / ru / en)", () => {
  it("example", () => {
    expect(classifyPhrase("Мысалы, Instagram-да рилс түсіресің").intent).toBe("example");
    expect(classifyPhrase("Например, возьмём кофейню").intent).toBe("example");
    expect(classifyPhrase("For example a coffee shop").intent).toBe("example");
  });
  it("compare", () => {
    expect(classifyPhrase("Телефон емес, компьютер керек").intent).toBe("compare");
    expect(classifyPhrase("Давайте сравним два способа").intent).toBe("compare");
    expect(classifyPhrase("Бұл қиын емес").intent).not.toBe("compare"); // plain negation
  });
  it("process", () => {
    expect(classifyPhrase("Алдымен видеоны жүктейсің").intent).toBe("process");
    expect(classifyPhrase("Сначала загружаем видео").intent).toBe("process");
    expect(classifyPhrase("Үш қадам бар").intent).toBe("process");
  });
  it("emotion, key, cta, question, neutral", () => {
    expect(classifyPhrase("Бұл керемет болды").intent).toBe("emotion");
    expect(classifyPhrase("Я так ждала этого!").intent).toBe("emotion");
    expect(classifyPhrase("Ең бастысы — тұрақтылық").intent).toBe("key");
    expect(classifyPhrase("Жазылыңыз, жаңа видео болады").intent).toBe("cta");
    expect(classifyPhrase("Сен оны білесің бе?").intent).toBe("question");
    expect(classifyPhrase("Бүгін біз монтаж туралы сөйлесеміз").intent).toBe("neutral");
  });
});

describe("card content comes from the spoken words", () => {
  it("compare splits around the connector", () => {
    const ab = splitCompare(ws("Телефон емес, компьютер керек", 1));
    expect(ab.map((x) => x.text)).toEqual(["Телефон", "компьютер"]);
    expect(ab[1]!.at).toBeGreaterThan(ab[0]!.at);
  });
  it("steps between sequence markers", () => {
    const steps = extractSteps([ws("Алдымен видеоны жүктейсің,", 1), ws("содан кейін стиль жазасың,", 3), ws("соңында дайын видео аласың.", 5)]);
    expect(steps.length).toBe(3);
    expect(steps[0]!.text.toLowerCase()).toContain("видеоны");
    expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort((a, b) => a - b));
  });
});

describe("auto beats: pacing rules", () => {
  const phrases = [
    ws("Сәлем, бүгін монтаж туралы", 0.2),
    ws("Мысалы, кофехана видеосы", 2.5),
    ws("онда көп кадр бар", 4.2),
    ws("Бұл керемет нәтиже берді!", 6.2),
    ws("Алдымен видеоны жүктейсің,", 8.5),
    ws("содан кейін стиль жазасың,", 10.2),
    ws("соңында дайын видео аласың.", 11.9),
    ws("Телефон емес, компьютер керек болды", 14.5),
    ws("Ең бастысы тұрақтылық", 17.5),
  ];
  const beats = autoBeats({ phrases, duration: 20, hasPerson: true });
  it("finds each meaning once and never touches the hook", () => {
    const intents = beats.map((b) => b.intent);
    expect(intents).toContain("example");
    expect(intents).toContain("process");
    expect(intents).toContain("emotion");
    expect(intents).toContain("key");
    expect(beats.every((b) => b.p0 > 0 || b.intent !== "example")).toBe(true);
  });
  it("layout beats last ≥ 1.6 s, take ≤ 50 % of the video, keep 2 s apart", () => {
    const lay = beats.filter((b) => b.card);
    let total = 0;
    let lastEnd = -Infinity;
    for (const b of lay) {
      const s = phrases[b.p0]![0]!.start;
      const e = phrases[b.p1]!.at(-1)!.end;
      expect(e - s).toBeGreaterThanOrEqual(1.6);
      expect(s - lastEnd).toBeGreaterThanOrEqual(2);
      total += e - s;
      lastEnd = e;
    }
    expect(total / 20).toBeLessThanOrEqual(0.5);
  });
  it("process beat has steps timed to the words", () => {
    const p = beats.find((b) => b.intent === "process")!;
    expect(p.card!.variant).toBe("steps");
    expect(p.card!.items.length).toBeGreaterThanOrEqual(2);
  });
  it("Claude's directions win over auto", () => {
    const d = DirectionsSchema.parse({ replaceAuto: false, beats: [{ start: 2.5, end: 5.5, intent: "compare", items: ["кофехана", "кадр"] }] });
    const manual = directionsToBeats(d, phrases);
    expect(manual[0]!.card!.variant).toBe("compare");
    expect(manual[0]!.card!.items[0]!.at).toBeCloseTo(phrases[1]![1]!.start, 2);
    const merged = mergeBeats(beats, manual, false);
    expect(merged.filter((b) => b.p0 <= 2 && b.p1 >= 1).map((b) => b.source)).toEqual(["claude"]);
  });
});

describe("layouts: window, compare, explainer", () => {
  const L = (kind: Layout["kind"], shape?: "rounded" | "circle"): Layout[] => [{ id: "l1", start: 2, end: 6, kind, secondary: null, secondaryKind: "graphic", secondaryW: 1080, secondaryH: 1920, shape }];
  it("pip window is inside the Reels safe zone and above the card", () => {
    const b = personBox("pip", 1080, 1920);
    const z = safeZone("reels");
    expect(insideSafe({ x0: b.x / 1080, x1: (b.x + b.w) / 1080, y0: b.y / 1920, y1: (b.y + b.h) / 1920 }, z)).toBe(true);
    expect((b.y + b.h) / 1920).toBeLessThan(cardRect("pip")!.y0);
  });
  it("the speaker slides into the window (animated) and back", () => {
    const at = (t: number) => personAt(L("pip"), t, 1080, 1920, 1080, 1920, "cover", { zoom: 1, ax: 0.5, ay: 0.35 });
    expect(at(1.9).box.w).toBe(1080);
    expect(at(2.1).box.w).toBeLessThan(1080);
    expect(at(2.1).box.w).toBeGreaterThan(personBox("pip", 1080, 1920).w);
    expect(at(4).box.w).toBeCloseTo(personBox("pip", 1080, 1920).w, 0);
    expect(layoutStateAt(L("pip"), 5.95).p).toBeLessThan(1);
  });
  it("explainer hides the speaker (no protected face zone) once the graphic covers the frame", () => {
    expect(personAt(L("explainer"), 4, 1080, 1920, 1080, 1920, "cover", { zoom: 1, ax: 0.5, ay: 0.35 }).visible).toBe(false);
    expect(personAt(L("explainer"), 2.05, 1080, 1920, 1080, 1920, "cover", { zoom: 1, ax: 0.5, ay: 0.35 }).visible).toBe(true);
  });
  it("captions near the bottom avoid the Instagram button column", () => {
    const z = safeZone("reels");
    const high = captionBand(z, 0.5);
    const low = captionBand(z, 0.75);
    expect(low.x1).toBeLessThanOrEqual(0.82 + 1e-9);
    expect(low.x1 - low.x0).toBeLessThan(high.x1 - high.x0);
    expect(insideSafe({ x0: 0.3, x1: 0.85, y0: 0.7, y1: 0.75 }, z)).toBe(false);
  });
});

describe("music ducking", () => {
  it("merges speech into spans (short pauses do not un-duck)", () => {
    const spans = speechSpans([...ws("бір екі үш", 0), ...ws("төрт бес", 3)]);
    expect(spans.length).toBe(2);
    expect(spans[0]![0]).toBe(0);
  });
});

import { headlineCard, parseNumber, splitList } from "../src/plan/director";

describe("reference techniques: numbers, lists, headlines", () => {
  it("numbers with units and thousands", () => {
    expect(parseNumber(ws("Instagram парақшамда 3 000 жазылушы", 1))).toMatchObject({ value: 3000, suffix: "жазылушы" });
    expect(parseNumber(ws("10 минутта жасадым", 1))).toMatchObject({ value: 10, suffix: "минутта" });
    expect(parseNumber(ws("нәтиже 87% жақсы", 1))).toMatchObject({ value: 87, suffix: "%" });
    expect(classifyPhrase("Мен бұл видеоны 10 минутта жасадым").intent).toBe("number");
  });
  it("a listing becomes orbit items", () => {
    expect(classifyPhrase("Онда субтитр, иконкалар, анимациялар бар").intent).toBe("list");
    expect(splitList(ws("Онда субтитр, иконкалар, анимациялар бар", 1)).map((x) => x.text)).toEqual(["субтитр", "иконкалар", "анимациялар"]);
  });
  it("headline keyword prefers nouns over verb forms", () => {
    const c = headlineCard(ws("Соңында дайын видео аласың", 1))!;
    expect(c.items[0]!.text).not.toBe("аласың");
    expect(c.variant).toBe("headline");
  });
});

import { parseEmphasisSeq } from "../src/plan/phrases";
describe("script emphasis spans", () => {
  it("*multi word* accents are clean and flagged", () => {
    const r = parseEmphasisSeq(["осы", "*Claude", "Code*", "сабағы", "*8", "жыл*", "*Диана*"]);
    expect(r.map((x) => x.text)).toEqual(["осы", "Claude", "Code", "сабағы", "8", "жыл", "Диана"]);
    expect(r.map((x) => x.emphasis)).toEqual([false, true, true, false, true, true, true]);
  });
});

describe("Claude headline direction", () => {
  it("uses the word Claude chose, not the longest one", async () => {
    const { headlineCard } = await import("../src/plan/director");
    const words = ws("connect her parent for ever with the race", 9.6);
    expect(headlineCard(words, "parent")!.items[0]!.text).toBe("parent");
    expect(headlineCard(words)!.items[0]!.text).not.toBe("parent");
  });
});
