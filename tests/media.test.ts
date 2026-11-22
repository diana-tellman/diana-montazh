import { describe, expect, it } from "vitest";
import { activityFromSilencedetect, aspectLabel, parseProbe } from "../src/core/media";
import { chooseFps, proxyArgs, scaleFilter } from "../src/core/transcode";

const iphone = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.5" },
  streams: [
    {
      codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, avg_frame_rate: "2850/100", r_frame_rate: "30/1",
      pix_fmt: "yuv420p10le", color_transfer: "arib-std-b67", color_primaries: "bt2020", color_space: "bt2020nc",
      side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
    },
    { codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 1 },
  ],
};

describe("parseProbe", () => {
  it("iPhone portrait HLG clip", () => {
    const m = parseProbe("a.mov", iphone, 100);
    expect(m.kind).toBe("video");
    expect(m.video).toMatchObject({ width: 1080, height: 1920, rotation: 270, orientation: "vertical", aspect: "9:16", hdr: "hlg", bitDepth: 10 });
    expect(m.video!.variableFrameRate).toBe(true);
    expect(m.audio).toEqual({ codec: "aac", sampleRate: 44100, channels: 1 });
  });
  it("audio-only file", () => {
    const m = parseProbe("v.m4a", { format: { duration: "30" }, streams: [{ codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }] }, 1);
    expect(m.kind).toBe("audio");
    expect(m.video).toBeNull();
  });
  it("cover art in audio is not treated as video", () => {
    const m = parseProbe("v.mp3", { format: { duration: "30" }, streams: [
      { codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2 },
      { codec_type: "video", codec_name: "mjpeg", width: 500, height: 500, disposition: { attached_pic: 1 } },
    ] }, 1);
    expect(m.kind).toBe("audio");
  });
  it("aspect labels", () => {
    expect(aspectLabel(1080, 1350)).toBe("4:5");
    expect(aspectLabel(1920, 1080)).toBe("16:9");
    expect(aspectLabel(1000, 700)).toBe("10:7");
  });
});

describe("transcode", () => {
  it("HDR source gets tone mapping and CFR", () => {
    const args = proxyArgs("in.mov", "out.mp4", parseProbe("a.mov", iphone, 1), { fps: 30, maxShortSide: 1080 });
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toContain("tonemap=mobius");
    expect(vf).toContain("fps=30");
    expect(args).toContain("libx264");
    expect(args).toContain("+faststart");
  });
  it("never upscales, keeps even dimensions", () => {
    expect(scaleFilter(720, 1280, 1080)).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(scaleFilter(2160, 3840, 1080)).toBe("scale=1080:-2:flags=lanczos");
    expect(scaleFilter(3840, 2160, 1080)).toBe("scale=-2:1080:flags=lanczos");
  });
  it("fps policy", () => {
    expect(chooseFps(59.94, false)).toBe(30);
    expect(chooseFps(59.94, true)).toBe(60);
    expect(chooseFps(29.97, true)).toBe(30);
  });
  it("silence → activity ratio", () => {
    const s = "silence_start: 0\nsilence_end: 2 | silence_duration: 2\nsilence_start: 8";
    expect(activityFromSilencedetect(s, 10)).toBeCloseTo(0.6);
  });
});
