import { describe, expect, it } from "vitest";
import { detectMode, type MaterialSummary } from "../src/core/modes";

const m = (over: Partial<MaterialSummary>): MaterialSummary => ({ videos: [], audios: [], photos: [], hasScript: false, ...over });

describe("detectMode — the voice is always the user's own recording", () => {
  it("talking video → expert-video", () => {
    expect(detectMode(m({ videos: [{ name: "a.mov", speechLikely: true }] }))).toMatchObject({ kind: "decided", mode: "expert-video" });
  });
  it("several talking videos → expert-video", () => {
    const d = detectMode(m({ videos: [{ name: "a.mov", speechLikely: true }, { name: "b.mov", speechLikely: true }] }));
    expect(d).toMatchObject({ kind: "decided", mode: "expert-video" });
  });
  it("voice recording only → voice-over-visuals (motion graphics)", () => {
    expect(detectMode(m({ audios: ["voice.m4a"] }))).toMatchObject({ kind: "decided", mode: "voice-over-visuals", voiceSource: "voice.m4a" });
  });
  it("voice recording + photos + silent clips → voice-over-visuals", () => {
    const d = detectMode(m({ audios: ["v.mp3"], photos: ["1.heic"], videos: [{ name: "b.mov", speechLikely: false }] }));
    expect(d).toMatchObject({ kind: "decided", mode: "voice-over-visuals" });
  });
  it("voice recording + talking video → asks which voice", () => {
    expect(detectMode(m({ audios: ["v.wav"], videos: [{ name: "a.mov", speechLikely: true }] })).kind).toBe("ask");
  });
  it("two recordings → asks", () => {
    expect(detectMode(m({ audios: ["a.mp3", "b.mp3"] })).kind).toBe("ask");
  });
  it("silent video / photos / script without voice → asks to upload a voice recording (no synthetic voice)", () => {
    for (const x of [m({ videos: [{ name: "a.mov", speechLikely: false }] }), m({ photos: ["p.jpg"] }), m({ hasScript: true })]) {
      const d = detectMode(x);
      expect(d.kind).toBe("ask");
      if (d.kind === "ask") expect(d.question).toMatch(/MP3, M4A или WAV/);
    }
  });
  it("nothing → asks for material", () => {
    expect(detectMode(m({})).kind).toBe("ask");
  });
});
