import type { MediaInfo } from "./project";

export type ProxyOptions = {
  /** Output frame rate. Default 30; pass the source fps to keep it. */
  fps: number;
  /** Largest allowed short side of the proxy. 1080 is enough for every export format. */
  maxShortSide: number;
};

/**
 * HDR → SDR tone mapping chain. iPhone records HLG (Dolby Vision 8.4) by default.
 * `mobius` keeps mid-tones and skin close to the original, unlike aggressive curves.
 */
export function tonemapFilter(hdr: "hlg" | "pq"): string {
  const tin = hdr === "hlg" ? "arib-std-b67" : "smpte2084";
  return [
    `zscale=tin=${tin}:pin=bt2020:min=bt2020nc:t=linear:npl=203`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=mobius:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
  ].join(",");
}

/** Even-dimension scale so the short side is at most `maxShortSide`; never upscales. */
export function scaleFilter(width: number, height: number, maxShortSide: number): string {
  const short = Math.min(width, height);
  if (short <= maxShortSide) return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  return width <= height ? `scale=${maxShortSide}:-2:flags=lanczos` : `scale=-2:${maxShortSide}:flags=lanczos`;
}

/**
 * ffmpeg args for the editing proxy: H.264 8-bit, yuv420p, BT.709, constant frame rate,
 * rotation applied (ffmpeg auto-rotates), AAC audio. Chromium (Remotion) decodes this
 * reliably on Linux, unlike iPhone HEVC 10-bit.
 */
export function proxyArgs(input: string, output: string, info: MediaInfo, opts: ProxyOptions): string[] {
  if (!info.video) throw new Error("proxyArgs: source has no video stream");
  const v = info.video;
  const filters: string[] = [];
  if (v.hdr !== "sdr") filters.push(tonemapFilter(v.hdr));
  filters.push(scaleFilter(v.width, v.height, opts.maxShortSide));
  filters.push(`fps=${opts.fps}`);
  filters.push("format=yuv420p");
  if (v.hdr === "sdr") filters.push("setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709");

  const args = ["-hide_banner", "-y", "-i", input, "-map", "0:v:0"];
  if (info.audio) args.push("-map", "0:a:0");
  args.push(
    "-vf", filters.join(","),
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-g", String(opts.fps), // keyframe every second → fast, accurate seeking in Remotion
    "-fps_mode", "cfr",
  );
  if (info.audio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  args.push("-movflags", "+faststart", output);
  return args;
}

/** 16 kHz mono PCM for speech recognition / analysis. */
export function analysisAudioArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-y", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output];
}

/** 48 kHz stereo PCM of the original voice, the master for enhancement and mixing. */
export function masterAudioArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-y", "-i", input, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s24le", output];
}

/** Pick the output fps: 30 by default; keep a standard source rate only when asked. */
export function chooseFps(sourceFps: number | undefined, keepSource: boolean): number {
  if (!keepSource || !sourceFps) return 30;
  const standard = [24, 25, 30, 50, 60];
  const nearest = standard.reduce((b, s) => (Math.abs(s - sourceFps) < Math.abs(b - sourceFps) ? s : b), 30);
  return nearest;
}

/**
 * Blurred, darkened full-frame background for formats the source does not fill
 * (e.g. horizontal video in 9:16). Rendered by ffmpeg at low resolution — far cheaper
 * than CSS blur in a CPU-only cloud browser (measured ~3x faster overall render).
 */
export function blurFillArgs(input: string, output: string, width: number, height: number): string[] {
  const vf = [
    `scale=${Math.round(width / 4)}:${Math.round(height / 4)}:force_original_aspect_ratio=increase`,
    `crop=${Math.round(width / 4)}:${Math.round(height / 4)}`,
    "boxblur=12:2",
    "eq=brightness=-0.08:saturation=0.85",
    `scale=${width}:${height}:flags=bilinear`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
  return ["-hide_banner", "-y", "-i", input, "-an", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "30", "-movflags", "+faststart", output];
}
