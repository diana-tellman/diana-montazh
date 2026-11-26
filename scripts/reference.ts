/**
 * npm run reference -- <id> <reference-video | images…>
 *
 * Measures what can be measured in a reference video and prepares what Claude must SEE:
 *  - colour grade → 3D LUT (.cube) matching the reference look, applied to the user's video at plan time;
 *  - pacing → scene cuts per second → camera energy;
 *  - loudness of the reference;
 *  - work/reference/frames.jpg — a sheet of reference frames: Claude looks at it (Read) and fills
 *    storyboard/reference-style.json (font class, case, size, colours, position, animation…).
 * Then: npm run plan -- <id> --reference
 * The reference file stays in the project folder (never committed). Nothing is copied from it into the video.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { runAnalysis } from "../src/analysis/python";
import { measureLevels } from "../src/audio/enhance";
import { probe } from "../src/core/media";
import { loadProject, pathsFor } from "../src/core/store";
import { main, out, parseArgs } from "./_cli";

const run = promisify(execFile);

const REFERENCE_TEMPLATE = {
  _howTo: "Claude: посмотри work/reference/frames.jpg и заполни поля по тому, что видно. Неизвестное оставь null.",
  source: "",
  font: null as string | null, // modern-sans | neutral-sans | geometric-bold | serif | condensed | rounded | rounded-bold | elegant
  weight: null as number | null, // 400–900
  uppercase: null as boolean | null,
  size: null as string | null, // small | medium | large
  textColor: null as string | null, // HEX
  accentColor: null as string | null, // HEX
  onAccent: null as string | null, // HEX text on accent plate
  position: null as string | null, // bottom | middle | top | auto
  wordsPerPhrase: null as number | null, // 1–6
  activeWord: null as string | null, // pill | color | scale | underline
  upcoming: null as string | null, // dim | hidden | visible
  backdrop: null as string | null, // shadow | glass | none
  animation: null as string | null, // pop | rise | fade | slide
  behindText: null as boolean | null,
  icons: null as boolean | null,
  layout: null as string | null, // auto | full | circle | split
  progressBar: null as boolean | null,
  sfx: null as boolean | null,
  grade: true,
  gradeStrength: 0.85,
  notes: "",
};

const IMG = /\.(jpe?g|png|webp|heic|heif)$/i;

main(async () => {
  const { pos } = parseArgs();
  const [id, ...refs] = pos;
  if (!id || !refs.length || refs.some((f) => !existsSync(f))) throw new Error("npm run reference -- <id> <образец.mp4 | картинки…>");
  const project = loadProject(id);
  const p = pathsFor(id);
  const dir = join(p.work, "reference");
  mkdirSync(dir, { recursive: true });
  const log = (s: string) => console.error(s);

  // Several references are allowed: videos (motion, colour, pacing) and images (typography, layout, palette).
  const tiles: Array<{ file: string; label: string }> = [];
  let video: string | null = null;
  let info: Awaited<ReturnType<typeof probe>> | null = null;
  for (const [n, refFile] of refs.entries()) {
    const ref = join(p.input, `reference-${n + 1}${extname(refFile).toLowerCase()}`);
    copyFileSync(refFile, ref);
    if (IMG.test(refFile)) {
      const f = join(dir, `img${n}.jpg`);
      await sharp(ref).rotate().resize({ width: 360, height: 640, fit: "contain", background: "#141414" }).jpeg({ quality: 88 }).toFile(f);
      tiles.push({ file: f, label: `картинка ${n + 1}` });
      continue;
    }
    const inf = await probe(ref);
    if (inf.kind !== "video") throw new Error(`${refFile}: не видео и не картинка.`);
    if (!video) (video = ref), (info = inf);
    const d = inf.durationSec;
    const times = [0.3, 0.8, 1.3, 1.8, 2.5, 3.5, d * 0.3, d * 0.45, d * 0.6, d * 0.75, d * 0.9, Math.max(0, d - 0.4)].filter((t) => t < d).slice(0, 12);
    for (const [i, t] of times.entries()) {
      const f = join(dir, `v${n}f${i}.jpg`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", ref, "-frames:v", "1", "-vf", "scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2:color=0x141414", f]);
      tiles.push({ file: f, label: `видео ${n + 1} · ${t.toFixed(1)} с` });
    }
  }
  const tw = 360;
  const th = 640;
  const cols = 4;
  const rows = Math.ceil(tiles.length / cols);
  const comps = tiles.flatMap((tile, i) => {
    const x = 8 + (i % cols) * (tw + 8);
    const y = 8 + Math.floor(i / cols) * (th + 44);
    const svg = `<svg width="${tw}" height="36" xmlns="http://www.w3.org/2000/svg"><text x="4" y="27" font-family="Inter" font-size="24" font-weight="700" fill="#fff">${tile.label}</text></svg>`;
    return [{ input: tile.file, left: x, top: y }, { input: Buffer.from(svg), left: x, top: y + th + 2 }];
  });
  const sheet = join(dir, "frames.jpg");
  await sharp({ create: { width: cols * (tw + 8) + 8, height: rows * (th + 44) + 8, channels: 3, background: "#141414" } }).composite(comps).jpeg({ quality: 88 }).toFile(sheet);

  // Measurements (only from a video reference).
  let analysis: Record<string, unknown> = { images: refs.filter((f) => IMG.test(f)).length };
  if (video && info) {
    const cuts = await runAnalysis<{ cutsPerSec: number; cuts: number[] }>(["cuts", video], log);
    const energy = cuts.cutsPerSec > 0.35 ? 2 : cuts.cutsPerSec < 0.12 ? 0 : 1;
    let grade: unknown = null;
    const mainVideo = project.assets.find((a) => a.role === "main-video");
    if (mainVideo) grade = await runAnalysis(["grade", video, join(p.root, mainVideo.prepared), join(dir, "grade.cube"), "--strength", "0.85"], log);
    const level = info.audio ? await measureLevels(video) : null;
    analysis = { ...analysis, reference: video, durationSec: info.durationSec, cutsPerSec: cuts.cutsPerSec, suggestedEnergy: energy, grade, loudnessLufs: level?.integratedLufs ?? null };
  }
  writeFileSync(join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));

  const styleFile = join(p.storyboard, "reference-style.json");
  if (!existsSync(styleFile)) writeFileSync(styleFile, JSON.stringify({ ...REFERENCE_TEMPLATE, source: refs.map((f) => f.split("/").pop()).join(", ") }, null, 2));
  out({
    id, frames: sheet, styleFile, measured: analysis,
    next: "Посмотри frames.jpg. Для схемы субтитров — заполни reference-style.json и plan --reference; для типографики/постеров — перенеси приёмы в beats.json (skill editorial-motion).",
  });
});
