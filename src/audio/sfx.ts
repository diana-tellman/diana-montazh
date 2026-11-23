import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Own sound-effect library, synthesised with ffmpeg (no third-party samples → no licence questions).
 * Peaks are normalised low; per-cue gain in the storyboard keeps them under the voice.
 */
export const SFX_RECIPES: Record<string, string> = {
  pop: "aevalsrc='0.8*sin(2*PI*(620*t-1500*t*t))*exp(-t*32)':s=48000:d=0.16,lowpass=f=3000",
  tick: "aevalsrc='0.8*sin(2*PI*3200*t)*exp(-t*220)':s=48000:d=0.04",
  soft: "aevalsrc='0.9*sin(2*PI*(110*t-120*t*t))*exp(-t*14)+0.08*(random(0)-0.5)*exp(-t*30)':s=48000:d=0.3",
  whoosh: "anoisesrc=d=0.55:color=pink:a=0.8:r=48000,bandpass=f=1400:w=1.2,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.25",
  riser: "anoisesrc=d=1.0:color=pink:a=0.5:r=48000,highpass=f=600,lowpass=f=5000,afade=t=in:d=0.95:curve=exp,afade=t=out:st=0.92:d=0.08",
  /** Subtle low impact: soft sub thump with a short air tail (important statements). */
  impact: "aevalsrc='0.9*sin(2*PI*(62*t-40*t*t))*exp(-t*9)+0.12*(random(0)-0.5)*exp(-t*25)':s=48000:d=0.6,lowpass=f=1800",
  /** Smooth swipe: short band-passed air sweep (underlines, transitions). */
  swipe: "anoisesrc=d=0.32:color=pink:a=0.7:r=48000,bandpass=f=2600:w=1.4,afade=t=in:d=0.12,afade=t=out:st=0.14:d=0.18",
  /** Clean UI click: two quick soft transients. */
  click: "aevalsrc='0.6*sin(2*PI*1900*t)*exp(-t*160)+0.35*sin(2*PI*1200*(t-0.03))*exp(-(t-0.03)*160)*gte(t,0.03)':s=48000:d=0.09",
};

export async function ensureSfx(projectRoot: string): Promise<string> {
  const dir = join(projectRoot, "work", "sfx");
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(SFX_RECIPES)) {
    const out = join(dir, `${name}.wav`);
    if (existsSync(out)) continue;
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-af", "aformat=channel_layouts=stereo,alimiter=limit=0.5", "-ar", "48000", "-c:a", "pcm_s16le", out]);
  }
  return dir;
}
