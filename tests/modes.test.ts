import { describe, expect, it } from "vitest";
import { detectMode } from "../src/core/modes";

const base = { request: "", hasVideo: false, hasAudioOnly: false, hasScript: false, speechLikely: null };

describe("detectMode", () => {
  it("own talking video → MODE 1, keeps original voice", () => {
    const d = detectMode({ ...base, hasVideo: true, speechLikely: true, request: "смонтируй рилс" });
    expect(d).toMatchObject({ kind: "decided", mode: "expert-video", keepOriginalVoice: true });
  });
  it("text only → MODE 2", () => {
    expect(detectMode({ ...base, hasScript: true })).toMatchObject({ kind: "decided", mode: "text-to-video" });
    expect(detectMode({ ...base, request: "Сделай видео по сценарию" })).toMatchObject({ mode: "text-to-video" });
    expect(detectMode({ ...base, request: "мәтін бойынша видео жаса" })).toMatchObject({ mode: "text-to-video" });
  });
  it("audio only → MODE 3, keeps original voice", () => {
    expect(detectMode({ ...base, hasAudioOnly: true, speechLikely: true })).toMatchObject({ kind: "decided", mode: "audio-to-video", keepOriginalVoice: true });
  });
  it("own video + narrator request → asks instead of replacing the voice", () => {
    const d = detectMode({ ...base, hasVideo: true, speechLikely: true, request: "сделай дикторскую озвучку" });
    expect(d.kind).toBe("ask");
    if (d.kind === "ask") expect(d.options).toEqual(["expert-video", "text-to-video"]);
  });
  it("own audio + narrator request → asks", () => {
    expect(detectMode({ ...base, hasAudioOnly: true, request: "add a voiceover" }).kind).toBe("ask");
  });
  it("explicit 'keep my voice' wins over narrator words", () => {
    const d = detectMode({ ...base, hasVideo: true, speechLikely: true, request: "оставь мой голос, без диктора" });
    expect(d).toMatchObject({ kind: "decided", mode: "expert-video" });
  });
  it("silent video → asks", () => {
    expect(detectMode({ ...base, hasVideo: true, speechLikely: false }).kind).toBe("ask");
  });
  it("nothing provided → asks for material", () => {
    expect(detectMode(base).kind).toBe("ask");
  });
});
