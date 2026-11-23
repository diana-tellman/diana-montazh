import { describe, expect, it } from "vitest";
import { computeWindow, chooseFraming, mapRect } from "../src/layout/frame";
import { inside, overlaps, safeZone } from "../src/layout/safeZones";
import { groupPhrases, parseEmphasis, splitLines, type TWord } from "../src/plan/phrases";
import { cameraAt } from "../src/storyboard/schema";
import { contrastRatio, resolveColor } from "../src/design/styles";

const w = (text: string, start: number, end: number): TWord => ({ text, start, end, emphasis: false });

describe("framing", () => {
  it("cover never shows frame edges, even with the anchor at a corner", () => {
    for (const z of [1, 1.2]) {
      const win = computeWindow(1080, 1920, 1080, 1920, "cover", { zoom: z, ax: 0.02, ay: 0.02 });
      expect(win.offX).toBeLessThanOrEqual(0);
      expect(win.offY).toBeLessThanOrEqual(0);
      expect(1080 * win.scale + win.offX).toBeGreaterThanOrEqual(1080 - 1e-6);
      expect(1920 * win.scale + win.offY).toBeGreaterThanOrEqual(1920 - 1e-6);
    }
  });
  it("horizontal video in 9:16 uses contain (no destructive crop), keeps aspect", () => {
    expect(chooseFraming(1920, 1080, 1080, 1920)).toBe("contain");
    expect(chooseFraming(1080, 1350, 1080, 1920)).toBe("cover");
    const win = computeWindow(1920, 1080, 1080, 1920, "contain", { zoom: 1, ax: 0.5, ay: 0.5 });
    expect(1920 * win.scale).toBeCloseTo(1080);
  });
  it("mapRect is consistent with the window", () => {
    const win = computeWindow(1080, 1920, 1080, 1920, "cover", { zoom: 1.2, ax: 0.5, ay: 0.3 });
    const r = mapRect({ x0: 0.4, x1: 0.6, y0: 0.2, y1: 0.4 }, 1080, 1920, 1080, 1920, win);
    expect(r.x1 - r.x0).toBeCloseTo(0.2 * 1.2);
  });
  it("camera eases into a push and holds cuts", () => {
    const keys = [
      { t: 0, zoom: 1, ax: 0.5, ay: 0.4, move: "cut" as const, dur: 0.9 },
      { t: 5, zoom: 1.2, ax: 0.5, ay: 0.4, move: "ease" as const, dur: 1 },
      { t: 8, zoom: 1.05, ax: 0.5, ay: 0.4, move: "cut" as const, dur: 0.9 },
    ];
    const id = (x: number) => x;
    expect(cameraAt(keys, 3, id).zoom).toBe(1);
    expect(cameraAt(keys, 4.5, id).zoom).toBeCloseTo(1.1);
    expect(cameraAt(keys, 6, id).zoom).toBe(1.2);
    expect(cameraAt(keys, 8.01, id).zoom).toBe(1.05);
  });
});

describe("safe zones", () => {
  it("reels zone excludes the right-side buttons and the bottom caption area", () => {
    const z = safeZone("reels");
    expect(z.x1).toBeLessThan(0.9);
    expect(z.y1).toBeLessThan(0.8);
    expect(inside({ x0: 0.2, x1: 0.8, y0: 0.5, y1: 0.6 }, z)).toBe(true);
    expect(overlaps({ x0: 0.9, x1: 0.95, y0: 0.5, y1: 0.6 }, { x0: z.x1, x1: 1, y0: 0, y1: 1 })).toBe(true);
  });
});

describe("phrasing", () => {
  it("breaks on pauses and sentence ends, merges orphans", () => {
    const ws = [w("Бүгін", 0, 0.4), w("мен", 0.4, 0.6), w("айтамын.", 0.6, 1.2), w("Бұл", 2, 2.3), w("оңай", 2.3, 2.7), w("және", 2.7, 3), w("қызықты", 3, 3.6)];
    const ph = groupPhrases(ws, { maxWords: 4, maxChars: 30, pause: 0.45, minDur: 0.6 });
    expect(ph.map((p) => p.map((x) => x.text).join(" "))).toEqual(["Бүгін мен айтамын.", "Бұл оңай және қызықты"]);
  });
  it("balances two lines without a one-word tail", () => {
    const ls = splitLines([w("Сегодня", 0, 1), w("я", 1, 1), w("покажу", 1, 2), w("три", 2, 2), w("шага", 2, 3)], 14);
    expect(ls).toHaveLength(2);
    expect(ls[1]!.length).toBeGreaterThan(1);
  });
  it("*emphasis* markers and numbers", () => {
    expect(parseEmphasis("*жүйе*.")).toEqual({ text: "жүйе.", emphasis: true });
    expect(parseEmphasis("5")).toEqual({ text: "5", emphasis: true });
    expect(parseEmphasis("сөз")).toEqual({ text: "сөз", emphasis: false });
  });
});

describe("colours", () => {
  it("user colour names in kk/ru/en", () => {
    expect(resolveColor("қызыл")).toBe("#E5192F");
    expect(resolveColor("красный")).toBe("#E5192F");
    expect(resolveColor("#ff0000")).toBe("#FF0000");
    expect(() => resolveColor("фиолетово-сиреневый")).toThrow();
  });
  it("contrast", () => {
    expect(contrastRatio("#FFFFFF", "#141414")).toBeGreaterThan(15);
  });
});
