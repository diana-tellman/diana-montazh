import { describe, expect, it } from "vitest";
import { ShowcaseSchema, showcaseChecks, showcaseDuration, zoomAt } from "../src/showcase/spec";
import { showcaseHash } from "../src/showcase/compat";

const base = {
  schema: 1, projectId: "x", version: 1, width: 1080, height: 1920, fps: 30, video: "v.mp4", voice: "a.wav", matteDir: "m",
  srcDuration: 10, freezeSec: 1, colors: { accent: "#701D35", dark: "#111111", light: "#FFFFFF" }, fonts: { display: "A", text: "B" },
  zoom: [{ t: 0, zoom: 1.4, ax: 0.5, ay: 0.3, move: "cut" }, { t: 3, zoom: 1, ax: 0.5, ay: 0.3, move: "ease", dur: 0.5 }],
  effects: [
    { type: "poster", start: 1, end: 3, anchorY: 0.17, items: [{ text: "БАРЛЫҚ", role: "sans", size: 0.2, at: 1 }] },
    { type: "label", start: 2.5, end: 4, y: 1330, words: [{ text: "а", at: 2.5 }] },
  ],
  captions: [], sfx: [], shots: [],
};

describe("showcase spec", () => {
  const s = ShowcaseSchema.parse(base);
  it("duration includes the freeze frame", () => expect(showcaseDuration(s)).toBe(11));
  it("camera: cut, hold, ease", () => {
    expect(zoomAt(s.zoom, 1).zoom).toBe(1.4);
    expect(zoomAt(s.zoom, 2.75).zoom).toBeLessThan(1.4);
    expect(zoomAt(s.zoom, 3.5).zoom).toBe(1);
  });
  it("flags two main texts at once", () => expect(showcaseChecks(s).some((c) => c.includes("Два текста"))).toBe(true));
  it("hash ignores the version number", () => expect(showcaseHash({ ...s, version: 7 })).toBe(showcaseHash(s)));
});
