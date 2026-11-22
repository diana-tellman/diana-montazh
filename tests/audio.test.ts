import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enhanceVoice, measureLevels, voiceChain } from "../src/audio/enhance";

describe("voice enhancement", () => {
  it("chain contains only corrective filters (no pitch/formant change)", () => {
    const c = voiceChain({ denoise: 1, deess: true, targetLufs: -16, truePeak: -1.5 });
    expect(c).not.toMatch(/rubberband|asetrate|atempo|pitch|vibrato|chorus/);
    expect(c).toContain("highpass");
  });
  it("normalises loudness and avoids clipping on real audio (ffmpeg)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dms-"));
    const src = join(dir, "in.wav");
    // Loud, clipping-prone input: two tones + noise at high gain.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      "aevalsrc='0.9*sin(2*PI*180*t)+0.3*sin(2*PI*2400*t)+0.05*random(0)':s=48000:d=4", "-ac", "2", src]);
    const out = join(dir, "out.wav");
    await enhanceVoice(src, out);
    const lv = await measureLevels(out);
    expect(lv.integratedLufs).toBeGreaterThan(-17.5);
    expect(lv.integratedLufs).toBeLessThan(-14.5);
    expect(lv.truePeakDb).toBeLessThanOrEqual(-1);
    expect(lv.clippedSamples).toBe(0);
  });
  it("detects clipping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dms-"));
    const src = join(dir, "clip.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=200:d=1", "-af", "volume=30", "-c:a", "pcm_s16le", src]);
    expect((await measureLevels(src)).clippedSamples).toBeGreaterThan(0);
  });
});
