import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Voice clean-up that keeps the speaker's identity:
 * no pitch shift, no formant change, no voice conversion, no generative "restoration".
 * Only corrective processing: rumble cut, mild denoise, gentle de-ess,
 * light compression and loudness normalisation.
 */
export type EnhanceOptions = {
  /** 0 = off, 1 = light (default), 2 = medium. Never "heavy" — it smears the voice. */
  denoise: 0 | 1 | 2;
  deess: boolean;
  /** Integrated loudness target for the voice stem. Final mix is normalised again. */
  targetLufs: number;
  truePeak: number;
};

export const DEFAULT_ENHANCE: EnhanceOptions = { denoise: 1, deess: true, targetLufs: -16, truePeak: -1.5 };

/** Corrective chain before loudness normalisation. Pure, unit-tested. */
export function voiceChain(o: EnhanceOptions): string {
  const f: string[] = ["highpass=f=70:poles=2"];
  if (o.denoise === 1) f.push("afftdn=nr=8:nf=-45:tn=1");
  if (o.denoise === 2) f.push("afftdn=nr=14:nf=-40:tn=1");
  if (o.deess) f.push("deesser=i=0.3:m=0.5:f=0.5");
  f.push("acompressor=threshold=-22dB:ratio=2.2:attack=15:release=180:makeup=1");
  return f.join(",");
}

export type LoudnormMeasure = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};

export function parseLoudnormJson(stderr: string): LoudnormMeasure {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm: measurement JSON not found in ffmpeg output");
  return JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasure;
}

/** Second-pass (linear where possible) loudnorm filter from first-pass measurements. */
export function loudnormPass2(m: LoudnormMeasure, targetLufs: number, truePeak: number): string {
  return (
    `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=11` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`
  );
}

/** Two-pass enhancement: corrective chain + EBU R128 loudness normalisation. */
export async function enhanceVoice(input: string, output: string, o: EnhanceOptions = DEFAULT_ENHANCE): Promise<LoudnormMeasure> {
  const chain = voiceChain(o);
  const pass1 = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", input, "-af", `${chain},loudnorm=I=${o.targetLufs}:TP=${o.truePeak}:LRA=11:print_format=json`, "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const m = parseLoudnormJson(pass1.stderr);
  await run(
    "ffmpeg",
    ["-hide_banner", "-y", "-i", input, "-af", `${chain},${loudnormPass2(m, o.targetLufs, o.truePeak)}`, "-ar", "48000", "-c:a", "pcm_s24le", output],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return m;
}

export type LevelReport = { integratedLufs: number; truePeakDb: number; clippedSamples: number };

/** Measure loudness, true peak and clipped samples (used by QC). */
export async function measureLevels(input: string): Promise<LevelReport> {
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", input, "-map", "0:a:0", "-af", "ebur128=peak=true,astats=measure_overall=Peak_level+Abs_Peak_count:measure_perchannel=none", "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return parseLevels(stderr);
}

export function parseLevels(stderr: string): LevelReport {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/);
  const tp = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
  const num = (s: string | undefined) => (s === undefined || s === "-inf" ? -Infinity : Number(s));
  // ffmpeg has no direct "clipped samples" stat: count samples sitting at full scale.
  const peakLevel = num([...stderr.matchAll(/Peak level dB: (-?[\d.]+|-inf)/g)].pop()?.[1]);
  const absPeakCount = Number([...stderr.matchAll(/Abs Peak count: ([\d.]+)/g)].pop()?.[1] ?? 0);
  const clippedSamples = peakLevel >= -0.01 ? absPeakCount : 0;
  return { integratedLufs: num(i?.[1]), truePeakDb: num(tp?.[1]), clippedSamples };
}
