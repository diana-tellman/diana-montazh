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
  pop: "aevalsrc='0.9*sin(2*PI*(820*t-2200*t*t))*exp(-t*38)':s=48000:d=0.16",
  tick: "aevalsrc='0.8*sin(2*PI*3200*t)*exp(-t*220)':s=48000:d=0.04",
  soft: "aevalsrc='0.9*sin(2*PI*(110*t-120*t*t))*exp(-t*14)+0.08*(random(0)-0.5)*exp(-t*30)':s=48000:d=0.3",
  whoosh: "anoisesrc=d=0.55:color=pink:a=0.8:r=48000,bandpass=f=1400:w=1.2,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.25",
  riser: "aevalsrc='0.5*sin(2*PI*(180*t+500*t*t))*(t/1.0)':s=48000:d=1.0,afade=t=out:st=0.85:d=0.15",
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
