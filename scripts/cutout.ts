/**
 * npm run cutout -- <photo | video> [--t <sec>] [--out <file.png>] [--model u2net_human_seg] [--matting]
 *
 * Background removal for ONE image with rembg: a photo, a cover frame, a slide picture.
 * For a video, the frame at --t (default 0) is taken first. Output: RGBA PNG (transparent background)
 * + preview on the brand colour (<out>-preview.jpg) — look at it before using.
 * Video frames over time use MediaPipe mattes instead (faster on CPU; `showcase`, behind-text).
 * Models: u2net_human_seg (people, default), isnet-general-use (objects), u2net (general).
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { runAnalysis } from "../src/analysis/python";
import { ROOT } from "../src/core/store";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);
const VIDEO = new Set([".mov", ".mp4", ".m4v", ".webm", ".mkv"]);

main(async () => {
  const { pos, opt } = parseArgs();
  const src = resolve(pos[0] ?? "");
  if (!pos[0]) throw new Error("Укажите фото или видео: npm run cutout -- <файл>");
  const dest = resolve(str(opt.out) ?? join(ROOT, "out", "cutout", basename(src, extname(src)) + "-cutout.png"));
  mkdirSync(dirname(dest), { recursive: true });
  let image = src;
  if (VIDEO.has(extname(src).toLowerCase())) {
    image = dest.replace(/\.png$/, "-frame.png");
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Number(str(opt.t) ?? 0)), "-i", src, "-frames:v", "1", image]);
  }
  const log = (s: string) => console.error(s);
  const res = await runAnalysis<{ out: string; width: number; height: number; foreground: number; model: string }>(
    ["cutout", image, dest, "--model", str(opt.model) ?? "u2net_human_seg", ...(opt.matting ? ["--matting"] : [])],
    log,
  );
  const preview = dest.replace(/\.png$/, "-preview.jpg");
  const meta = await sharp(dest).metadata();
  const flat = await sharp({ create: { width: meta.width!, height: meta.height!, channels: 3, background: "#8D263E" } }).composite([{ input: dest }]).png().toBuffer();
  await sharp(flat).resize({ width: 540 }).jpeg({ quality: 85 }).toFile(preview);
  out({ ...res, preview, warning: res.foreground < 0.02 ? "Почти ничего не вырезано — проверьте, есть ли человек/объект, или выберите --model isnet-general-use." : null });
});
