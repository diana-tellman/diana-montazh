/**
 * npm run reference -- <id> <reference-video>
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

main(async () => {
  const { pos } = parseArgs();
  const [id, refFile] = pos;
  if (!id || !refFile || !existsSync(refFile)) throw new Error("npm run reference -- <id> <reference-video>");
  const project = loadProject(id);
  const p = pathsFor(id);
  const dir = join(p.work, "reference");
  mkdirSync(dir, { recursive: true });
  const ref = join(p.input, "reference" + extname(refFile).toLowerCase());
  copyFileSync(refFile, ref);
  const info = await probe(ref);
  if (info.kind !== "video") throw new Error("Референс должен быть видео.");
  const log = (s: string) => console.error(s);

  // Frames sheet for Claude's eyes: dense at the start (hook), then spread.
  const d = info.durationSec;
  const times = [0.3, 0.8, 1.3, 1.8, 2.5, 3.5, d * 0.3, d * 0.45, d * 0.6, d * 0.75, d * 0.9, Math.max(0, d - 0.4)].filter((t) => t < d).slice(0, 12);
  const tiles: string[] = [];
  for (const [i, t] of times.entries()) {
    const f = join(dir, `f${i}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", ref, "-frames:v", "1", "-vf", "scale=360:-2", f]);
    tiles.push(f);
  }
  const m = await sharp(tiles[0]!).metadata();
  const tw = m.width!;
  const th = m.height!;
  const cols = 4;
  const rows = Math.ceil(tiles.length / cols);
  const comps = tiles.flatMap((f, i) => {
    const x = 8 + (i % cols) * (tw + 8);
    const y = 8 + Math.floor(i / cols) * (th + 44);
    const svg = `<svg width="${tw}" height="36" xmlns="http://www.w3.org/2000/svg"><text x="4" y="27" font-family="Inter" font-size="24" font-weight="700" fill="#fff">${times[i]!.toFixed(1)} с</text></svg>`;
    return [{ input: f, left: x, top: y }, { input: Buffer.from(svg), left: x, top: y + th + 2 }];
  });
  const sheet = join(dir, "frames.jpg");
  await sharp({ create: { width: cols * (tw + 8) + 8, height: rows * (th + 44) + 8, channels: 3, background: "#141414" } }).composite(comps).jpeg({ quality: 88 }).toFile(sheet);

  // Measurements.
  const cuts = await runAnalysis<{ cutsPerSec: number; cuts: number[] }>(["cuts", ref], log);
  const energy = cuts.cutsPerSec > 0.35 ? 2 : cuts.cutsPerSec < 0.12 ? 0 : 1;
  let grade: unknown = null;
  const mainVideo = project.assets.find((a) => a.role === "main-video");
  if (mainVideo) {
    grade = await runAnalysis(["grade", ref, join(p.root, mainVideo.prepared), join(dir, "grade.cube"), "--strength", "0.85"], log);
  }
  const level = info.audio ? await measureLevels(ref) : null;
  const analysis = { reference: ref, durationSec: d, size: `${info.video?.width}×${info.video?.height}`, cutsPerSec: cuts.cutsPerSec, suggestedEnergy: energy, grade, loudnessLufs: level?.integratedLufs ?? null };
  writeFileSync(join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));

  const styleFile = join(p.storyboard, "reference-style.json");
  if (!existsSync(styleFile)) writeFileSync(styleFile, JSON.stringify({ ...REFERENCE_TEMPLATE, source: refFile.split("/").pop() }, null, 2));
  out({
    id, frames: sheet, styleFile, measured: analysis,
    next: "Посмотри frames.jpg, заполни reference-style.json, затем: npm run plan -- <id> --reference [явные пожелания пользователя как флаги]",
  });
});
