import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { extname } from "node:path";
import { promisify } from "node:util";
import type { MediaInfo } from "./project";

const run = promisify(execFile);

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
};
export type ProbeJson = {
  format?: { format_name?: string; duration?: string; size?: string };
  streams?: ProbeStream[];
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

function ratio(r: string | undefined): number {
  if (!r) return 0;
  const [a, b] = r.split("/").map(Number);
  if (!a || !b) return 0;
  return a / b;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function aspectLabel(w: number, h: number): string {
  const known: Array<[string, number]> = [["9:16", 9 / 16], ["16:9", 16 / 9], ["4:5", 4 / 5], ["1:1", 1], ["3:4", 3 / 4], ["4:3", 4 / 3]];
  const r = w / h;
  for (const [label, v] of known) if (Math.abs(r - v) / v < 0.02) return label;
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function bitDepthOf(s: ProbeStream): number {
  const raw = Number(s.bits_per_raw_sample);
  if (raw) return raw;
  const pf = s.pix_fmt ?? "";
  const m = pf.match(/p(\d{2})(le|be)?$/);
  return m ? Number(m[1]) : 8;
}

/** Pure parser of `ffprobe -show_format -show_streams -of json` output. Unit-tested. */
export function parseProbe(path: string, probe: ProbeJson, sizeBytes: number): MediaInfo {
  const streams = probe.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === "audio");
  const duration = Number(probe.format?.duration ?? 0) || 0;
  const container = probe.format?.format_name ?? "unknown";

  let video: MediaInfo["video"] = null;
  if (v && v.width && v.height) {
    const sideRot = v.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation;
    const tagRot = v.tags?.rotate ? Number(v.tags.rotate) : undefined;
    const rotation = (((sideRot ?? tagRot ?? 0) % 360) + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    const width = swap ? v.height : v.width;
    const height = swap ? v.width : v.height;
    const avg = ratio(v.avg_frame_rate);
    const real = ratio(v.r_frame_rate);
    const fps = avg || real || 30;
    const transfer = v.color_transfer ?? "unknown";
    const hdr = transfer === "arib-std-b67" ? "hlg" : transfer === "smpte2084" ? "pq" : "sdr";
    video = {
      codec: v.codec_name ?? "unknown",
      width,
      height,
      codedWidth: v.width,
      codedHeight: v.height,
      rotation,
      fps: Math.round(fps * 1000) / 1000,
      variableFrameRate: avg > 0 && real > 0 && Math.abs(avg - real) / real > 0.01,
      orientation: width > height ? "horizontal" : width < height ? "vertical" : "square",
      aspect: aspectLabel(width, height),
      pixFmt: v.pix_fmt ?? "unknown",
      bitDepth: bitDepthOf(v),
      colorTransfer: transfer,
      colorPrimaries: v.color_primaries ?? "unknown",
      colorSpace: v.color_space ?? "unknown",
      hdr,
    };
  }

  const audio: MediaInfo["audio"] = a
    ? { codec: a.codec_name ?? "unknown", sampleRate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0 }
    : null;

  let kind: MediaInfo["kind"] = "unknown";
  if (IMAGE_EXT.has(extname(path).toLowerCase()) || (video && duration === 0 && !audio)) kind = "image";
  else if (video) kind = "video";
  else if (audio) kind = "audio";

  return { path, kind, container, durationSec: duration, sizeBytes, video, audio };
}

export async function probe(path: string): Promise<MediaInfo> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return parseProbe(path, JSON.parse(stdout) as ProbeJson, statSync(path).size);
}

/**
 * Rough speech-activity check: share of non-silent audio.
 * This is NOT speech recognition — it only tells "there is sustained sound
 * at voice level". Real speech detection comes from transcription.
 */
export async function soundActivityRatio(path: string, durationSec: number): Promise<number> {
  if (durationSec <= 0) return 0;
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-map", "0:a:0", "-af", "highpass=f=100,lowpass=f=4000,silencedetect=n=-38dB:d=0.4", "-f", "null", "-"],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return activityFromSilencedetect(stderr, durationSec);
}

export function activityFromSilencedetect(stderr: string, durationSec: number): number {
  let silent = 0;
  for (const m of stderr.matchAll(/silence_duration: ([\d.]+)/g)) silent += Number(m[1]);
  // A trailing silence_start without an end runs to the end of the file.
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].length;
  if (starts.length > ends) silent += Math.max(0, durationSec - (starts[starts.length - 1] ?? durationSec));
  return Math.max(0, Math.min(1, 1 - silent / durationSec));
}
