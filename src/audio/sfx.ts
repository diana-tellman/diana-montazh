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
  swipe: "anoisesrc=d=0.32:color=white:a=0.7:r=48000,highpass=f=2500,lowpass=f=9000,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.2",
  click: "aevalsrc='0.9*sin(2*PI*1800*t)*exp(-t*160)+0.4*sin(2*PI*900*t)*exp(-t*120)':s=48000:d=0.06",
  type: "aevalsrc='0.7*sin(2*PI*2600*mod(t,0.085))*exp(-mod(t,0.085)*260)*(0.6+0.4*sin(t*53))':s=48000:d=0.6,afade=t=out:st=0.5:d=0.1",
  ding: "aevalsrc='0.5*sin(2*PI*1318*t)*exp(-t*6)+0.35*sin(2*PI*1975*t)*exp(-t*8)':s=48000:d=0.7",
  tickroll: "aevalsrc='0.6*sin(2*PI*3000*mod(t,0.06))*exp(-mod(t,0.06)*300)*(1-t/0.8)':s=48000:d=0.8",
  impact: "aevalsrc='0.9*sin(2*PI*(70*t-40*t*t))*exp(-t*7)+0.25*(random(0)-0.5)*exp(-t*25)':s=48000:d=0.6",
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
