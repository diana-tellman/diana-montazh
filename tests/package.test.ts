import { describe, expect, it } from "vitest";
import { buildShotList, shotListMarkdown } from "../src/storyboard/shotlist";
import type { Storyboard } from "../src/storyboard/schema";
import { countWords, scriptBlocks, scriptMarkdown, wordsFor } from "../src/script/voiceScript";
import { DeckSchema, deckWarnings, slideTexts } from "../src/present/deck";

const w = (text: string, start: number, emphasis = false) => ({ text, start, end: start + 0.3, emphasis });
const sb = {
  version: 2, format: "9:16", durationSec: 9, mode: "expert-video", style: { source: "bordeaux" },
  visuals: [{ id: "v1", start: 0, end: 9, kind: "video", src: "x.mp4", srcStart: 0, srcW: 1080, srcH: 1920, framing: "cover", fill: null }],
  captions: [
    { id: "c1", start: 0.2, end: 1.5, lines: [[w("Сәлем", 0.2), w("бәріне", 0.6, true)]], y: 0.7, scale: 1 },
    { id: "c2", start: 3.2, end: 4.5, lines: [[w("мысалы", 3.2), w("рилс", 3.7)]], y: 0.7, scale: 1 },
    { id: "c3", start: 6.5, end: 8, lines: [[w("жазылыңыз", 6.5)]], y: 0.7, scale: 1 },
  ],
  layouts: [{ id: "l1", start: 3, end: 6, kind: "pip", secondary: null, secondaryKind: "graphic", secondaryW: 1080, secondaryH: 1920, shape: "circle",
    card: { variant: "example", title: "", items: [{ text: "Рилс", icon: null, at: 3.7 }] } }],
  camera: [{ t: 0, zoom: 1, ax: 0.5, ay: 0.4, move: "cut", dur: 0.9 }, { t: 2.6, zoom: 1.12, ax: 0.5, ay: 0.4, move: "ease", dur: 0.6 }],
  behindText: [], callouts: [{ id: "k1", start: 6.5, end: 8.5, text: "Жазылыңыз", kind: "cta", y: 0.3 }], icons: [], widgets: [],
  sfx: [{ t: 2.9, kind: "whoosh", gain: 0.15, reason: "" }],
  scenes: [
    { index: 1, start: 0, end: 3, keyT: 1, title: "", onScreenText: "", camera: "", animation: "", sfx: "", checks: [] },
    { index: 2, start: 3, end: 6, keyT: 4, title: "", onScreenText: "", camera: "", animation: "", sfx: "", checks: [] },
    { index: 3, start: 6, end: 9, keyT: 7, title: "", onScreenText: "", camera: "", animation: "", sfx: "", checks: [] },
  ],
} as unknown as Storyboard;

describe("shot list (раскадровка кестесі)", () => {
  const shots = buildShotList(sb);
  it("covers the whole video without gaps, numbered", () => {
    expect(shots.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(shots[0]!.start).toBe(0);
    expect(shots.at(-1)!.end).toBe(9);
    shots.slice(1).forEach((s, i) => expect(s.start).toBe(shots[i]!.end));
  });
  it("spoken words, text moments, inside changes and transitions", () => {
    expect(shots[0]!.spoken).toBe("Сәлем бәріне");
    expect(shots[0]!.changes.some((c) => c.what.includes("жақындайды") && Math.abs(c.t - 2) < 0.01)).toBe(true);
    expect(shots[0]!.transition).toContain("терезеге");
    expect(shots[0]!.transition).toContain("whoosh");
    expect(shots[1]!.screen).toContain("терезеде");
    expect(shots[1]!.texts.some((t) => t.what.includes("Рилс") && t.t === 3.7)).toBe(true);
    expect(shots[1]!.transition).toContain("оралады");
    expect(shots[2]!.texts.some((t) => t.what.startsWith("батырма"))).toBe(true);
    expect(shots[2]!.transition).toContain("соңы");
  });
  it("markdown tells how to change a frame", () => {
    const md = shotListMarkdown(sb);
    expect(md).toContain("## 2-кадр · 0:03.0–0:06.0");
    expect(md).toContain("3-кадрды өзгерт");
  });
});

describe("voice script for the user's own recording", () => {
  const text = "Сәлем! Бүгін *рилс* монтажын үйренеміз.\n\nАлдымен видеоны жүктейсің. Содан кейін Claude раскадровка жасайды.";
  it("counts words without accent marks and estimates time", () => {
    expect(countWords("*Claude Code* — керемет!")).toBe(3);
    const b = scriptBlocks(text, "kk");
    expect(b).toHaveLength(2);
    expect(b[0]!.from).toBe(0);
    expect(b[1]!.from).toBeGreaterThan(b[0]!.to);
    expect(wordsFor(30, "kk")).toBe(57);
  });
  it("markdown has bold accents and recording instructions", () => {
    const md = scriptMarkdown("Тест", text, "kk");
    expect(md).toContain("**рилс**");
    expect(md).toContain("чатқа жібер");
  });
});

describe("presentation deck", () => {
  it("defaults and texts", () => {
    const d = DeckSchema.parse({ title: "Т", slides: [{ layout: "compare", title: "А мен Б", left: { title: "Телефон", points: ["жеңіл"] }, right: { title: "Компьютер", points: ["күшті"] } }] });
    expect(d.format).toBe("16:9");
    expect(d.theme.font).toBe("Arial");
    expect(slideTexts(d.slides[0]!)).toEqual(["А мен Б", "Телефон", "жеңіл", "Компьютер", "күшті"]);
    expect(deckWarnings(d)).toEqual([]);
  });
  it("warns about overloaded slides", () => {
    const d = DeckSchema.parse({ title: "Т", slides: [{ title: "x", bullets: ["a", "b", "c", "d", "e", "f"] }] });
    expect(deckWarnings(d)[0]).toContain("5");
  });
});
