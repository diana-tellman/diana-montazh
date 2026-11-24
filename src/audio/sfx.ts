import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Own sound-effect library, synthesised with ffmpeg (no third-party samples → no licence questions).
 * Each sound is peak-normalised to −3 dBFS; the per-cue gain in the storyboard sets its level in the mix.
 */
export const SFX_RECIPES: Record<string, string> = {
  /** Soft Air Whoosh — large text appears / moves. */
  whoosh: "anoisesrc=d=0.7:color=pink:a=0.9:r=48000,highpass=f=250,lowpass=f=6000,afade=t=in:d=0.38:curve=exp,afade=t=out:st=0.38:d=0.32,aecho=0.6:0.4:40:0.25",
  /** Gentle Paper Swipe — underlines, slides, background change. */
  swipe: "anoisesrc=d=0.3:color=white:a=0.8:r=48000,bandpass=f=3200:w=1.2,afade=t=in:d=0.05,afade=t=out:st=0.08:d=0.22",
  /** Tactile Soft Pop — icons / final accent. */
  pop: "aevalsrc='0.9*sin(2*PI*(760*t-1900*t*t))*exp(-t*30)+0.15*(random(0)-0.5)*exp(-t*300)':s=48000:d=0.18,lowpass=f=3500",
  /** Muted Cinematic Impact — key statements. */
  impact: "aevalsrc='0.95*sin(2*PI*(58*t-30*t*t))*exp(-t*5)+0.25*(random(0)-0.5)*exp(-t*18)':s=48000:d=1.1,lowpass=f=1400,aecho=0.7:0.5:60|120:0.3|0.15",
  /** Clean UI Click. */
  click: "aevalsrc='0.7*sin(2*PI*2000*t)*exp(-t*150)+0.4*sin(2*PI*1250*(t-0.028))*exp(-(t-0.028)*150)*gte(t,0.028)':s=48000:d=0.1",
  /** Light Digital Sweep — segmentation / cut-out. */
  sweep: "aevalsrc='0.5*sin(2*PI*(900*t+3600*t*t))*sin(PI*t/0.42)':s=48000:d=0.42,aecho=0.6:0.4:35:0.3",
  /** Elegant Tonal Accent — script reveals. */
  tonal: "aevalsrc='0.5*sin(2*PI*880*t)*exp(-t*3.2)+0.3*sin(2*PI*1318.5*t)*exp(-t*4)+0.18*sin(2*PI*1760*t)*exp(-t*6)':s=48000:d=1.4,afade=t=in:d=0.01,aecho=0.7:0.5:80|160:0.3|0.15",
  /** Light Electric Trace — outline drawing. */
  trace: "anoisesrc=d=0.8:color=white:a=0.6:r=48000,bandpass=f=5200:w=0.6,tremolo=f=28:d=0.7,afade=t=in:d=0.08,afade=t=out:st=0.5:d=0.3",
  /** Soft digital tick — diagram steps. */
  tick: "aevalsrc='0.8*sin(2*PI*3000*t)*exp(-t*200)':s=48000:d=0.05",
  soft: "aevalsrc='0.9*sin(2*PI*(110*t-120*t*t))*exp(-t*14)+0.08*(random(0)-0.5)*exp(-t*30)':s=48000:d=0.3",
  /** Gentle riser — build-up before the main moment. */
  riser: "anoisesrc=d=1.0:color=pink:a=0.6:r=48000,highpass=f=500,lowpass=f=6000,afade=t=in:d=0.95:curve=exp,afade=t=out:st=0.92:d=0.08",
};

export async function ensureSfx(projectRoot: string): Promise<string> {
  const dir = join(projectRoot, "work", "sfx");
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(SFX_RECIPES)) {
    const out = join(dir, `${name}.wav`);
    if (existsSync(out)) continue;
    const raw = join(dir, `${name}.raw.wav`);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-af", "aformat=channel_layouts=stereo", "-ar", "48000", "-c:a", "pcm_s16le", raw]);
    // Peak-normalise every sound to −3 dBFS so the storyboard gain alone sets its level in the mix.
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", raw, "-af", "volumedetect", "-f", "null", "-"]);
    const peak = Number(stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `volume=${(-3 - peak).toFixed(2)}dB`, "-c:a", "pcm_s16le", out]);
    await run("rm", ["-f", raw]);
  }
  return dir;
}
