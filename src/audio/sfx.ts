import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT } from "../core/store";

const run = promisify(execFile);

/**
 * SFX system v2.
 * Sources, in priority order for every semantic sound name:
 *  1. assets/sfx/<name>.(wav|mp3|ogg) in the repository — the owner/student's own licensed pack;
 *  2. the bundled CC0 library `uisfx` (public domain, redistributable), chosen by theme;
 *  3. layered synthesis (whoosh / impact / riser / trace have cinematic layers on top).
 * Every sound is peak-normalised to −3 dBFS; the storyboard gain sets its level in the mix.
 */
export const SFX_NAMES = ["whoosh", "swipe", "pop", "impact", "click", "sweep", "tonal", "trace", "tick", "soft", "riser", "reveal", "type", "bell"] as const;
export type SfxName = (typeof SFX_NAMES)[number];
export const SFX_THEMES = ["cinematic", "soft", "glass", "studio", "minimal", "dreamy", "organic", "mechanical", "scifi", "zen", "rubber", "arcade"] as const;
export type SfxTheme = (typeof SFX_THEMES)[number];

/** Semantic name → uisfx sound (CC0). */
const UISFX_MAP: Partial<Record<SfxName, string>> = {
  swipe: "swipe", pop: "select", click: "press", tick: "snap", sweep: "expand", tonal: "notification",
  trace: "scanning", soft: "drop", reveal: "open", type: "typing", bell: "success",
};

/** Synth layers (ffmpeg lavfi). Cinematic sounds get layered on top of / instead of library sounds. */
const SYNTH: Record<string, string> = {
  air: "anoisesrc=d=0.75:color=pink:a=0.9:r=48000,highpass=f=300,lowpass=f=7000,afade=t=in:d=0.4:curve=exp,afade=t=out:st=0.4:d=0.35,aecho=0.6:0.5:35|70:0.3|0.15",
  sub: "aevalsrc='0.95*sin(2*PI*(55*t-26*t*t))*exp(-t*4.5)':s=48000:d=1.2",
  hit: "anoisesrc=d=0.35:color=brown:a=0.9:r=48000,lowpass=f=900,afade=t=out:st=0.02:d=0.33",
  tail: "anoisesrc=d=1.4:color=pink:a=0.25:r=48000,lowpass=f=2500,afade=t=in:d=0.02,afade=t=out:st=0.05:d=1.35,aecho=0.8:0.6:90|180|270:0.35|0.22|0.12",
  rise: "anoisesrc=d=1.2:color=pink:a=0.6:r=48000,highpass=f=500,lowpass=f=7000,afade=t=in:d=1.12:curve=exp,afade=t=out:st=1.12:d=0.08",
  riseTone: "aevalsrc='0.35*sin(2*PI*(200*t+260*t*t))*(t/1.2)':s=48000:d=1.2",
  spark: "anoisesrc=d=0.8:color=white:a=0.5:r=48000,bandpass=f=5200:w=0.6,tremolo=f=28:d=0.7,afade=t=in:d=0.08,afade=t=out:st=0.5:d=0.3",
  bellTone: "aevalsrc='0.5*sin(2*PI*880*t)*exp(-t*3.2)+0.3*sin(2*PI*1318.5*t)*exp(-t*4)+0.18*sin(2*PI*1760*t)*exp(-t*6)':s=48000:d=1.4,aecho=0.7:0.5:80|160:0.3|0.15",
};
/** Recipes: list of layers. "lib" = library sound for this name. */
const RECIPE: Record<SfxName, string[]> = {
  whoosh: ["air", "lib:swipe"],
  swipe: ["lib"],
  pop: ["lib"],
  impact: ["sub", "hit", "tail"],
  click: ["lib"],
  sweep: ["lib"],
  tonal: ["lib", "bellTone"],
  trace: ["spark", "lib"],
  tick: ["lib"],
  soft: ["lib"],
  riser: ["rise", "riseTone"],
  reveal: ["lib"],
  type: ["lib"],
  bell: ["bellTone"],
};

function userFile(name: string): string | null {
  const dir = join(ROOT, "assets", "sfx");
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.replace(/\.(wav|mp3|ogg|m4a)$/i, "") === name);
  return f ? join(dir, f) : null;
}

function libFile(theme: SfxTheme, sound: string): string | null {
  const f = join(ROOT, "node_modules", "uisfx", "sounds", theme, `${sound}.mp3`);
  return existsSync(f) ? f : null;
}

async function peakNormalise(input: string, out: string): Promise<void> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", input, "-af", "volumedetect", "-f", "null", "-"]);
  const peak = Number(stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
  await run("ffmpeg", ["-v", "error", "-y", "-i", input, "-af", `aformat=channel_layouts=stereo,aresample=48000,volume=${(-3 - peak).toFixed(2)}dB`, "-c:a", "pcm_s16le", out]);
}

export async function buildSfx(name: SfxName, theme: SfxTheme, out: string): Promise<string> {
  const tmp = out.replace(/\.wav$/, "");
  const user = userFile(name);
  if (user) {
    await peakNormalise(user, out);
    return "assets/sfx";
  }
  const layers: string[] = [];
  for (const [i, l] of RECIPE[name].entries()) {
    const f = `${tmp}.l${i}.wav`;
    if (l.startsWith("lib")) {
      const sound = l.includes(":") ? l.split(":")[1]! : UISFX_MAP[name];
      const lf = sound ? libFile(theme, sound) : null;
      if (!lf) continue;
      await run("ffmpeg", ["-v", "error", "-y", "-i", lf, "-af", "aformat=channel_layouts=stereo,aresample=48000", "-c:a", "pcm_s16le", f]);
    } else {
      await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", SYNTH[l]!, "-af", "aformat=channel_layouts=stereo", "-ar", "48000", "-c:a", "pcm_s16le", f]);
    }
    layers.push(f);
  }
  if (!layers.length) throw new Error(`Нет источника для звука ${name}`);
  const mix = `${tmp}.mix.wav`;
  if (layers.length === 1) await run("cp", [layers[0]!, mix]);
  else await run("ffmpeg", ["-v", "error", "-y", ...layers.flatMap((l) => ["-i", l]), "-filter_complex", `amix=inputs=${layers.length}:normalize=0:duration=longest`, "-c:a", "pcm_s16le", mix]);
  await peakNormalise(mix, out);
  await run("rm", ["-f", mix, ...layers]);
  return RECIPE[name].some((l) => l.startsWith("lib")) ? `uisfx/${theme} (CC0)` : "synth";
}

/** Prepare all SFX for a project (cached; rebuilt when the theme or user pack changes). */
export async function ensureSfx(projectRoot: string, theme: SfxTheme = "cinematic"): Promise<string> {
  const dir = join(projectRoot, "work", "sfx");
  mkdirSync(dir, { recursive: true });
  const userDir = join(ROOT, "assets", "sfx");
  const key = `v2:${theme}:${existsSync(userDir) ? readdirSync(userDir).sort().join(",") : ""}`;
  const stamp = join(dir, ".key");
  const fresh = existsSync(stamp) && readFileSync(stamp, "utf8") === key;
  for (const name of SFX_NAMES) {
    const out = join(dir, `${name}.wav`);
    if (fresh && existsSync(out)) continue;
    await buildSfx(name, theme, out);
  }
  writeFileSync(stamp, key);
  return dir;
}
