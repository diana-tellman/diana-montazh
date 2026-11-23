import { describe, expect, it } from "vitest";
import { iconForWord, ICONS } from "../src/design/icons";
import { clipToPerson, personBox, personWindow } from "../src/layout/person";
import { layoutAt } from "../src/storyboard/schema";

describe("icons", () => {
  it("match words in kk / ru / en to icons", () => {
    expect(iconForWord("телефонмен")).toBe("phone");
    expect(iconForWord("Жазылыңыз!")).toBe("bell");
    expect(iconForWord("подписаться.")).toBe("bell");
    expect(iconForWord("ақша")).toBe("money");
    expect(iconForWord("минут")).toBe("clock");
    expect(iconForWord("ideas")).toBe("idea");
    expect(iconForWord("және")).toBeNull();
  });
  it("every mapped icon has paths", () => {
    for (const w of ["телефон", "ақша", "уақыт", "идея", "дайын", "любовь", "үздік", "нәтиже", "видео", "коммент", "жазылу", "қате", "тренд", "мақсат", "сабақ", "бонус", "сілтеме", "көрермен"]) {
      const n = iconForWord(w);
      expect(n, w).not.toBeNull();
      expect(ICONS[n!]!.length).toBeGreaterThan(0);
    }
  });
});

describe("layouts", () => {
  it("circle is centred and round; split puts the person in the bottom half", () => {
    const c = personBox("circle", 1080, 1920);
    expect(c.w).toBe(c.h);
    expect(c.x + c.w / 2).toBe(540);
    const s = personBox("split", 1080, 1920);
    expect(s.y).toBe(960);
  });
  it("person window keeps the face inside the box", () => {
    const win = personWindow("split", 1080, 1920, 1080, 1920, "cover", { zoom: 1, ax: 0.5, ay: 0.3 });
    const faceY = 0.3 * 1920 * win.scale + win.offY;
    expect(faceY).toBeGreaterThan(960);
    expect(faceY).toBeLessThan(1920);
  });
  it("hidden parts of the person are not protected zones", () => {
    const r = clipToPerson({ x0: 0.3, x1: 0.7, y0: 0.4, y1: 0.7 }, "split", 1080, 1920);
    expect(r.y0).toBeCloseTo(0.5);
  });
  it("layoutAt defaults to full", () => {
    const L = [{ id: "l1", start: 2, end: 4, kind: "split" as const, secondary: null, secondaryKind: "graphic" as const, secondaryW: 1, secondaryH: 1 }];
    expect(layoutAt(L, 1)).toBe("full");
    expect(layoutAt(L, 3)).toBe("split");
    expect(layoutAt(L, 4)).toBe("full");
  });
});
