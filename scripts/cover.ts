/**
 * npm run cover -- <id> [--title "Текст *акцент*"] [--word СӨЗ] [--tag "Сабақ 1"] [--t 7.2] [--no-word]
 * Only after a successful final render. Picks the best real frame (big centred face, mouth
 * closed, sharp), cuts out the person for the word-behind-head effect, renders cover.png
 * plus a preview of the 3:4 profile-grid crop.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import sharp from "sharp";
import { runAnalysis } from "../src/analysis/python";
import { loadProject, pathsFor, saveProject } from "../src/core/store";
import { hasReached, transition } from "../src/core/state";
import { bundleFor, renderStills } from "../src/render/stills";
import { loadFaces, loadStoryboard } from "../src/storyboard/store";
import { main, out, parseArgs, str } from "./_cli";

main(async () => {
  const { pos, opt } = parseArgs();
  const id = pos[0] ?? "";
  let project = loadProject(id);
  if (!hasReached(project, "rendered")) throw new Error("Обложка делается только после успешного финального рендера.");
  const p = pathsFor(id);
  const sb = loadStoryboard(id);
  const faces = loadFaces(id);
  const log = (s: string) => console.error(s);
  const dir = join(p.output, "cover-work");
  mkdirSync(dir, { recursive: true });

  const video = sb.visuals.find((v) => v.kind === "video" && v.src);
  let frameRel: string | null = null;
  let cutoutRel: string | null = null;
  let srcW = sb.width;
  let srcH = sb.height;
  let face: { cx: number; cy: number; headTop: number; chinY: number } | null = null;
  let t: number | null = null;

  if (video?.src && faces) {
    const vPath = join(p.root, video.src);
    if (str(opt.t)) t = Number(opt.t);
    else {
      const cands = await runAnalysis<Array<{ file: string; t: number; score: number }>>(["cover-candidates", vPath, join(p.work, "faces.json"), join(dir, "candidates"), "--n", "4"], log);
      if (!cands.length) throw new Error("Не найден подходящий кадр с лицом для обложки.");
      t = cands[0]!.t;
    }
    srcW = video.srcW;
    srcH = video.srcH;
    const frameAbs = join(dir, "frame.jpg");
    // Exact frame at t, full resolution.
    await new Promise<void>((res, rej) => execFile("ffmpeg", ["-v", "error", "-y", "-ss", t!.toFixed(3), "-i", vPath, "-frames:v", "1", "-q:v", "2", frameAbs], (e) => (e ? rej(e) : res())));
    frameRel = relative(p.root, frameAbs);
    if (!opt["no-word"]) {
      const mdir = join(dir, `matte-${t!.toFixed(2)}`);
      if (!existsSync(join(mdir, "00001.webp"))) await runAnalysis(["matte", vPath, mdir, "--start", t!.toFixed(3), "--end", (t! + 0.05).toFixed(3), "--fps", "30"], log);
      cutoutRel = relative(p.root, join(mdir, "00001.webp"));
    }
    const s = faces.samples.reduce((b, x) => (Math.abs(x.t - t!) < Math.abs(b.t - t!) ? x : b), faces.samples[0]!);
    if (s.face) face = { cx: s.face.cx, cy: s.face.cy, headTop: s.face.headTop, chinY: s.face.chinY };
  } else {
    const photo = sb.visuals.find((v) => v.kind === "photo" && v.src);
    if (photo?.src) (frameRel = photo.src), (srcW = photo.srcW), (srcH = photo.srcH);
  }

  const words = sb.captions.flatMap((c) => c.lines.flat());
  const autoWord = sb.behindText[0]?.text ?? words.filter((w) => w.emphasis && w.text.replace(/[^\p{L}]/gu, "").length >= 3).map((w) => w.text.replace(/[^\p{L}\p{N}]/gu, "")).find((w) => w.length <= 10) ?? null;
  const word = opt["no-word"] ? null : (str(opt.word) ?? autoWord);
  const firstSentence = words.map((w) => w.text).join(" ").split(/(?<=[.!?…])\s/)[0] ?? "";
  const title = str(opt.title) ?? firstSentence.split(" ").slice(0, 7).join(" ").replace(/[,:;]$/, "");
  const props = {
    width: sb.width, height: sb.height, frame: frameRel, cutout: word ? cutoutRel : null, srcW, srcH, face, word, title,
    tag: str(opt.tag) ?? null, colors: { text: sb.style.colors.text, accent: sb.style.colors.accent, onAccent: sb.style.colors.onAccent },
  };
  const serveUrl = await bundleFor(p.root);
  const cover = join(p.output, "cover.png");
  await renderStills({ serveUrl, compositionId: "Cover", jobs: [{ frame: 0, inputProps: props, output: cover }], format: "png" });

  // Profile grid preview: Instagram shows a centred 3:4 crop of a 9:16 cover.
  const grid = join(p.output, "cover-grid-preview.jpg");
  if (sb.format === "9:16") {
    const h34 = Math.round((sb.width * 4) / 3);
    await sharp(cover).extract({ left: 0, top: Math.round((sb.height - h34) / 2), width: sb.width, height: h34 }).jpeg({ quality: 88 }).toFile(grid);
  } else copyFileSync(cover, grid);
  project = transition(project, "cover_done", `Обложка: «${title}»`);
  saveProject(project);
  out({ id, cover, gridPreview: grid, t, title, word: props.cutout ? word : null });
});
