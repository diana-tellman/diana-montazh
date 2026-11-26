import { describe, expect, it } from "vitest";
import { speechTimes } from "../src/plan/planner";
import { BeatSchema } from "../src/storyboard/schema";

describe("poster stack engine", async () => {
  const { layoutPoster } = await import("../src/compositions/poster").catch(() => ({ layoutPoster: null }));
  it.skipIf(!layoutPoster)("fits the width, keeps order and lets the accent overlap the bold line", () => {
    const b = BeatSchema.parse({
      kind: "poster", id: "p", start: 0, end: 2, anchorY: 0.5, maxWidth: 0.7,
      items: [
        { text: "осының барлығын", role: "label", size: 0.045, at: 0 },
        { text: "БІР СТИЛЬДЕ КӘСІБИ МОНТАЖ ӨТЕ ҰЗЫН ЖОЛ", role: "sans", size: 0.2, at: 0 },
        { text: "кәсіби", role: "italic", size: 0.14, at: 0 },
      ],
    });
    if (b.kind !== "poster") throw new Error();
    const pl = layoutPoster!(b, 1080, 1920);
    expect(pl[1]!.w).toBeLessThanOrEqual(0.7 * 1080 + 0.5);
    expect(pl[0]!.y).toBeLessThan(pl[1]!.y);
    expect(pl[1]!.y).toBeLessThan(pl[2]!.y);
    // italic crosses the sans line: its top is above the sans bottom
    expect(pl[2]!.y - pl[2]!.h / 2).toBeLessThan(pl[1]!.y + pl[1]!.h / 2);
    const mid = (pl[0]!.y - pl[0]!.h / 2 + pl[2]!.y + pl[2]!.h / 2) / 2;
    expect(Math.abs(mid - 960)).toBeLessThan(2);
  });
});

describe("speech-synced word times", () => {
  it("finds spoken words after the poster start", () => {
    const words = [{ text: "Бірақ", start: 1.9 }, { text: "оның", start: 2.2 }, { text: "*барлық*", start: 2.5 }, { text: "мүмкіндігін", start: 2.84 }];
    expect(speechTimes("барлық мүмкіндігін", 2.4, words)).toEqual([2.45, 2.79]);
  });
});
