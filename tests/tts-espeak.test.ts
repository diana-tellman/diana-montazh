import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { synthesizeNarration } from "../src/voice/tts";

const hasEspeak = (() => {
  try {
    execFileSync("espeak-ng", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasEspeak)("draft narration (espeak-ng, offline)", () => {
  it("synthesizes kk / ru / en segments into one timed voiceover", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "dms-tts-"));
    for (const [voiceId, text] of [
      ["espeak-kk", "Сәлем! Бүгін Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І әріптерін тексереміз."],
      ["espeak-ru", "Привет! Это черновая озвучка."],
      ["espeak-en-us", "Hello, this is a draft voice."],
    ] as const) {
      const { wav, timings } = await synthesizeNarration({
        voiceId, workDir, modelsDir: workDir, allowDraftVoice: true,
        segments: [{ sceneId: "s1", text }, { sceneId: "s2", text: "2" }],
      });
      expect(existsSync(wav)).toBe(true);
      expect(timings).toHaveLength(2);
      expect(timings[1]!.startSec).toBeGreaterThan(timings[0]!.endSec);
      const meta = JSON.parse(readFileSync(join(workDir, "voiceover.timings.json"), "utf8"));
      expect(meta.provider).toBe("espeak-draft");
    }
  });
  it("refuses draft voice for final narration without explicit acceptance", async () => {
    await expect(
      synthesizeNarration({ voiceId: "espeak-kk", workDir: tmpdir(), modelsDir: tmpdir(), allowDraftVoice: false, segments: [{ sceneId: "s1", text: "a" }] }),
    ).rejects.toThrow(/черновой/);
  });
});
