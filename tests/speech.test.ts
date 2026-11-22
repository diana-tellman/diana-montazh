import { describe, expect, it } from "vitest";
import { alignScript, alignWords, similarity } from "../src/speech/align";
import { importTranscript, parseSubtitles, parseTimecode, parseTimecodedLines } from "../src/speech/import";
import { MODELS } from "../src/speech/models";
import { estimateWords, toRemotionCaptions, TranscriptSchema, type Transcript } from "../src/speech/transcript";

describe("timing", () => {
  it("estimated words fill the phrase contiguously", () => {
    const w = estimateWords("Сәлем, бүгін біз монтаж туралы сөйлесеміз.", 1000, 4000);
    expect(w[0]!.startMs).toBe(1000);
    expect(w.at(-1)!.endMs).toBe(4000);
    for (let i = 1; i < w.length; i++) expect(w[i]!.startMs).toBe(w[i - 1]!.endMs);
  });
  it("timecodes", () => {
    expect(parseTimecode("00:01:02,500")).toBe(62500);
    expect(parseTimecode("1:02.5")).toBe(62500);
    expect(parseTimecode("7")).toBe(7000);
  });
});

describe("import", () => {
  it("SRT with Kazakh letters", () => {
    const srt = "1\n00:00:00,500 --> 00:00:02,000\nӘ Ғ Қ Ң Ө\n\n2\n00:00:02,100 --> 00:00:04,000\nҰ Ү Һ І <i>сөз</i>\n";
    const s = parseSubtitles(srt);
    expect(s).toHaveLength(2);
    expect(s[1]!.text).toBe("Ұ Ү Һ І сөз");
    expect(s[0]!.startMs).toBe(500);
  });
  it("WebVTT", () => {
    const s = parseSubtitles("WEBVTT\n\n00:01.000 --> 00:03.000 align:start\nПривет мир\n");
    expect(s[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: "Привет мир" });
  });
  it("timecoded lines", () => {
    const s = parseTimecodedLines("0:00 Сәлеметсіз бе!\n[0:03.5] Бүгін монтаж\nбез таймкода — пропуск", 6000);
    expect(s.map((x) => [x.startMs, x.endMs])).toEqual([[0, 3500], [3500, 6000]]);
  });
  it("produces a valid transcript", () => {
    expect(() => TranscriptSchema.parse(importTranscript("0:00 a\n0:01 b", 2000))).not.toThrow();
    expect(() => importTranscript("no timecodes", 1000)).toThrow();
  });
});

describe("script alignment", () => {
  it("similarity tolerates ASR spelling errors", () => {
    expect(similarity("смонтировать", "смотеровать")).toBeGreaterThan(0.6);
    expect(similarity("Сәлем!", "сәлем")).toBe(1);
  });
  it("aligns with insertions and deletions", () => {
    const m = alignWords(["сегодня", "я", "раскачу", "как", "монтировать"], ["Сегодня", "я", "расскажу,", "как", "смонтировать", "видео"]);
    expect(m.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(m[5]).toBe(-1);
  });
  it("uses the exact script words with audio timing", () => {
    const t: Transcript = {
      version: 1, source: "asr", model: "x", language: "kk", durationMs: 6000,
      timing: { segments: "measured", words: "estimated" }, needsReview: true, notes: [],
      segments: [
        { startMs: 0, endMs: 2000, text: "Сәлі мертсіз бір", words: estimateWords("Сәлі мертсіз бір", 0, 2000) },
        { startMs: 2500, endMs: 5000, text: "Бүген монтаждау керек", words: estimateWords("Бүген монтаждау керек", 2500, 5000) },
      ],
    };
    const { transcript, matchRatio } = alignScript(t, "Сәлеметсіз бе! Бүгін монтаждау керек.");
    expect(transcript.source).toBe("script-aligned");
    expect(transcript.segments.map((s) => s.text)).toEqual(["Сәлеметсіз бе!", "Бүгін монтаждау керек."]);
    expect(transcript.segments[1]!.words[0]!.startMs).toBeGreaterThanOrEqual(2500);
    expect(matchRatio).toBeGreaterThan(0.4);
    const caps = toRemotionCaptions(transcript);
    expect(caps[0]).toMatchObject({ text: "Сәлеметсіз" });
    expect(caps[1]!.text.startsWith(" ")).toBe(true);
  });
});

describe("model registry", () => {
  it("every model is pinned by sha256 and comes from official sherpa-onnx releases", () => {
    for (const m of Object.values(MODELS)) {
      expect(m.url.startsWith("https://github.com/k2-fsa/sherpa-onnx/releases/download/")).toBe(true);
      for (const h of Object.values(m.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

import { SpeechTimeline } from "../src/speech/align";
import { isRepetitionLoop } from "../src/speech/transcribe";

describe("robustness", () => {
  it("detects Whisper repetition loops, keeps normal text", () => {
    expect(isRepetitionLoop("Құрғағағағағағағағағағағағағағағағаға")).toBe(true);
    expect(isRepetitionLoop("да да да да да да да да да")).toBe(true);
    expect(isRepetitionLoop("Сегодня я расскажу, как смонтировать короткое видео для Instagram.")).toBe(false);
    expect(isRepetitionLoop("Бүгін мен сіздерге қысқа видеоны қалай монтаждау керектігін айтып беремін.")).toBe(false);
  });
  it("speech timeline skips pauses", () => {
    const tl = new SpeechTimeline([{ startMs: 0, endMs: 1000 }, { startMs: 3000, endMs: 4000 }]);
    expect(tl.total).toBe(2000);
    expect(tl.toWall(1000, true)).toBe(3000);
    expect(tl.toWall(1000)).toBe(1000);
    expect(tl.toSpeech(2000)).toBe(1000);
    expect(tl.toWall(1500)).toBe(3500);
  });
  it("poor recognition: script words spread over speech, never in pauses", () => {
    const t: Transcript = {
      version: 1, source: "asr", model: "x", language: "kk", durationMs: 9000,
      timing: { segments: "measured", words: "estimated" }, needsReview: true, notes: [],
      segments: [
        { startMs: 0, endMs: 1000, text: "", words: [] },
        { startMs: 5000, endMs: 8000, text: "", words: [] },
      ],
    };
    const { transcript } = alignScript(t, "Бір екі үш төрт бес алты жеті сегіз");
    for (const s of transcript.segments) for (const w of s.words) {
      const inSpeech = (w.startMs >= 0 && w.startMs < 1000) || (w.startMs >= 5000 && w.startMs < 8000);
      expect(inSpeech).toBe(true);
    }
    expect(transcript.needsReview).toBe(true);
  });
});
