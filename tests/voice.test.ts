import { describe, expect, it } from "vitest";
import type { Project } from "../src/core/project";
import { assertCanSynthesize, assertFinalVoiceAllowed, estimateWords, layoutSegments, VoicePolicyError } from "../src/voice/tts";
import { findVoice, piperUrl, VOICES } from "../src/voice/voices";

const tts = { type: "tts" as const, provider: "piper" as const, voice: "kk_KZ-issai-high", language: "kk" as const };
const mk = (over: Partial<Project>): Project => ({
  schemaVersion: 1, id: "t", createdAt: "", updatedAt: "", mode: "text-to-video", status: "approved", language: "kk",
  source: null, scriptFile: null, voice: tts, voiceReplacementConsent: false, history: [], ...over,
});

describe("voice policy", () => {
  it("MODE 2: final TTS only after approval", () => {
    expect(() => assertCanSynthesize(mk({ status: "storyboard_draft" }), { forPreview: false })).toThrow(VoicePolicyError);
    expect(() => assertCanSynthesize(mk({ status: "approved" }), { forPreview: false })).not.toThrow();
    expect(() => assertCanSynthesize(mk({ status: "storyboard_draft" }), { forPreview: true })).not.toThrow();
  });
  it("MODE 1/3: original voice cannot be replaced without consent", () => {
    for (const mode of ["expert-video", "audio-to-video"] as const) {
      expect(() => assertCanSynthesize(mk({ mode }), { forPreview: true })).toThrow(/согласия/);
      expect(() => assertCanSynthesize(mk({ mode, voiceReplacementConsent: true }), { forPreview: false })).not.toThrow();
    }
  });
  it("draft voice is refused for final render unless accepted", () => {
    const draft = findVoice("espeak-kk")!;
    expect(() => assertFinalVoiceAllowed(draft, false)).toThrow(VoicePolicyError);
    expect(() => assertFinalVoiceAllowed(draft, true)).not.toThrow();
    expect(() => assertFinalVoiceAllowed(findVoice("kk_KZ-issai-high")!, false)).not.toThrow();
  });
  it("catalogue covers kk, ru, en and has no cloning entries", () => {
    for (const l of ["kk", "ru", "en"]) expect(VOICES.some((v) => v.language === l && v.provider === "piper")).toBe(true);
    expect(VOICES.every((v) => v.provider === "piper" || v.provider === "espeak-draft")).toBe(true);
  });
  it("piper urls", () => {
    expect(piperUrl(findVoice("kk_KZ-issai-high")!, "onnx")).toBe(
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/kk/kk_KZ/issai/high/kk_KZ-issai-high.onnx",
    );
  });
});

describe("narration timing", () => {
  it("word estimates are contiguous and fill the segment", () => {
    const w = estimateWords("Сәлем, бүгін біз монтаж туралы сөйлесеміз.", 1, 4);
    expect(w[0]!.startMs).toBe(1000);
    expect(w.at(-1)!.endMs).toBe(4000);
    for (let i = 1; i < w.length; i++) expect(w[i]!.startMs).toBe(w[i - 1]!.endMs);
    expect(w.every((x) => x.timing === "estimated")).toBe(true);
  });
  it("segments do not overlap and keep order", () => {
    const t = layoutSegments([
      { sceneId: "s1", text: "a b", durationSec: 1.5 },
      { sceneId: "s2", text: "c", durationSec: 2 },
    ]);
    expect(t[0]!.startSec).toBeCloseTo(0.3);
    expect(t[1]!.startSec).toBeGreaterThan(t[0]!.endSec);
  });
});
