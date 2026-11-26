/**
 * npm run plan -- <id> [--style brand|minimal|kinetic|glass|lime] [--format 9:16|16:9|4:5|1:1]
 *   [--platform reels|stories|shorts|tiktok|feed|square|youtube] [--text <color>] [--accent <color>]
 *   [--position auto|top|middle|bottom] [--no-behind] [--no-sfx] [--no-progress] [--energy 0|1|2]
 *   [--layout auto|full|circle|split] [--no-icons]
 *   [--reference] [--no-reference] [--font modern-sans|neutral-sans|geometric-bold|serif|condensed|rounded|rounded-bold|elegant]
 *   [--size small|medium|large] [--upper|--lower]
 *   [--sfx-theme cinematic|soft|glass|studio|minimal|dreamy|organic|mechanical|scifi|zen|rubber|arcade]
 *   [--beats]  use storyboard/beats.json authored by Claude: {beats, camera, layouts, sfx, voiceSrc, gradeFilter}
 *
 * Builds the edit plan (storyboard.json) from the transcript, face analysis and options.
 * Runs analysis/transcription automatically if they are missing. Any re-plan revokes approval.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { ensureSfx, SFX_THEMES, type SfxTheme } from "../src/audio/sfx";
import { FORMATS, type FormatId } from "../src/formats";
import { chooseFraming } from "../src/layout/frame";
import { defaultPlatform, type Platform } from "../src/layout/safeZones";
import { blurFillArgs } from "../src/core/transcode";
import { loadProject, pathsFor, saveProject } from "../src/core/store";
import { canTransition, transition } from "../src/core/state";
import { resolveColor, StylePresetSchema } from "../src/design/styles";
import { buildStoryboard, DEFAULT_OPTIONS, type PlanOptions } from "../src/plan/planner";
import { validateStoryboard } from "../src/plan/validate";
import { loadFaces, loadTranscript, revokeApproval, saveStoryboard, sbFile } from "../src/storyboard/store";
import { FONT_CLASSES } from "../src/design/fontNames";
import { referenceOptions, SIZE } from "../src/plan/reference";
import type { Authored } from "../src/plan/planner";
import { BeatSchema } from "../src/storyboard/schema";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);
const sh = (cmd: string, args: string[]) => run("npx", ["tsx", ...[cmd], ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 3_600_000 });

main(async () => {
  const { pos, opt } = parseArgs();
  const id = pos[0] ?? "";
  let project = loadProject(id);
  const p = pathsFor(id);

  // Prerequisites, automatically.
  if (!existsSync(join(p.work, "transcript.json"))) await sh("scripts/transcribe.ts", [id]);
  if (project.mode === "expert-video" && !existsSync(join(p.work, "faces.json"))) await sh("scripts/analyze.ts", [id]);

  const optFile = join(p.storyboard, "options.json");
  let prev: PlanOptions = existsSync(optFile) ? { ...DEFAULT_OPTIONS, ...JSON.parse(readFileSync(optFile, "utf8")) } : { ...DEFAULT_OPTIONS };
  // Reference video scheme (filled by Claude from work/reference/frames.jpg). Explicit flags below still win.
  if (opt.reference) prev = { ...prev, ...referenceOptions(p.root, p.storyboard, p.work) };
  if (opt["no-reference"]) prev = { ...prev, styleOverrides: {}, styleSource: undefined, grade: null };
  const format = (str(opt.format) ?? prev.format) as FormatId;
  const o: PlanOptions = {
    ...prev,
    format,
    platform: (str(opt.platform) as Platform) ?? (format !== prev.format ? defaultPlatform(format) : prev.platform),
    style: str(opt.style) ? StylePresetSchema.parse(opt.style) : prev.style,
    captionPosition: (str(opt.position) as PlanOptions["captionPosition"]) ?? prev.captionPosition,
    behindText: opt["no-behind"] ? false : opt.behind ? true : prev.behindText,
    sfx: opt["no-sfx"] ? false : opt.sfx ? true : prev.sfx,
    progressBar: opt["no-progress"] ? false : opt.progress ? true : prev.progressBar,
    cameraEnergy: str(opt.energy) ? (Number(opt.energy) as 0 | 1 | 2) : prev.cameraEnergy,
    layout: (str(opt.layout) as PlanOptions["layout"]) ?? prev.layout ?? "auto",
    icons: opt["no-icons"] ? false : opt.icons ? true : prev.icons ?? true,
    styleOverrides: { ...(prev.styleOverrides ?? {}), ...(str(opt.font) ? { font: FONT_CLASSES[str(opt.font)!] ?? (str(opt.font) as never) } : {}), ...(opt.upper ? { uppercase: true } : {}), ...(opt.lower ? { uppercase: false } : {}), ...(str(opt.size) ? { size: SIZE[str(opt.size)!] ?? Number(opt.size) } : {}) },
    colors: {
      ...(str(opt.style) ? {} : prev.colors),
      ...(str(opt.text) ? { text: resolveColor(str(opt.text)!) } : {}),
      ...(str(opt.accent) ? { accent: resolveColor(str(opt.accent)!) } : {}),
      ...(str(opt["on-accent"]) ? { onAccent: resolveColor(str(opt["on-accent"])!) } : {}),
    },
  };
  if (opt.beats) {
    const bf = join(p.storyboard, "beats.json");
    if (!existsSync(bf)) throw new Error("Нет storyboard/beats.json");
    const a = JSON.parse(readFileSync(bf, "utf8")) as Authored & { gradeFilter?: string };
    o.authored = { beats: (a.beats ?? []).map((b) => BeatSchema.parse(b)), camera: a.camera, layouts: a.layouts, sfx: a.sfx, voiceSrc: a.voiceSrc, captionWindows: (a as { captionWindows?: Array<[number, number]> }).captionWindows };
    if ((a as { styleOverrides?: object }).styleOverrides) o.styleOverrides = { ...(o.styleOverrides ?? {}), ...(a as { styleOverrides?: object }).styleOverrides };
    if (a.gradeFilter) o.grade = { lut: "", strength: 1, from: "коррекция", filter: a.gradeFilter } as never;
  } else if (opt["no-beats"]) o.authored = null;
  if (!FORMATS[o.format]) throw new Error(`Неизвестный формат ${o.format}`);

  // Blurred fills for videos that will be shown "contain" in this format.
  const fills: Record<string, string> = {};
  const fmt = FORMATS[o.format];
  for (const a of project.assets.filter((x) => (x.role === "main-video" || x.role === "broll-video") && x.info.video)) {
    const v = a.info.video!;
    if (chooseFraming(v.width, v.height, fmt.width, fmt.height) !== "contain") continue;
    const rel = a.prepared.replace(/\.mp4$/, `.fill-${o.format.replace(":", "x")}.mp4`);
    if (!existsSync(join(p.root, rel))) await run("ffmpeg", blurFillArgs(join(p.root, a.prepared), join(p.root, rel), fmt.width, fmt.height));
    fills[a.id] = rel;
  }
  const sfxTheme = (str(opt["sfx-theme"]) ?? (opt.beats ? (JSON.parse(readFileSync(join(p.storyboard, "beats.json"), "utf8")) as { sfxTheme?: string }).sfxTheme : undefined) ?? "cinematic") as SfxTheme;
  if (!SFX_THEMES.includes(sfxTheme)) throw new Error(`Неизвестная тема звуков ${sfxTheme}. Есть: ${SFX_THEMES.join(", ")}`);
  await ensureSfx(p.root, sfxTheme);

  // Colour grade from the reference, baked into a graded proxy by ffmpeg.
  const graded: Record<string, string> = {};
  if (o.grade) {
    for (const a of project.assets.filter((x) => x.role === "main-video")) {
      const rel = a.prepared.replace(/\.mp4$/, ".graded.mp4");
      const stamp = join(p.root, rel + ".lut");
      const g = o.grade as { lut: string; strength: number; filter?: string };
      const vf = g.filter ?? `lut3d=file=${join(p.root, g.lut)}`;
      const lutKey = `${vf}@${g.strength}`;
      if (!existsSync(join(p.root, rel)) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== lutKey) {
        await run("ffmpeg", ["-v", "error", "-y", "-i", join(p.root, a.prepared), "-map", "0:v:0", "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-g", "30", "-movflags", "+faststart", join(p.root, rel)]);
        writeFileSync(stamp, lutKey);
      }
      graded[a.id] = rel;
    }
  }

  // Black-and-white version of the person's video for editorial "mono" backgrounds.
  if (o.authored?.beats?.some((b) => (b.kind === "poster" && b.bg === "mono") || (b.kind === "punch" && b.mono))) {
    const mv = project.assets.find((x) => x.role === "main-video");
    if (mv) {
      const src = graded[mv.id] ?? mv.prepared;
      const rel = mv.prepared.replace(/\.mp4$/, ".mono.mp4");
      if (!existsSync(join(p.root, rel))) await run("ffmpeg", ["-v", "error", "-y", "-i", join(p.root, src), "-map", "0:v:0", "-vf", "hue=s=0,eq=contrast=1.12:brightness=-0.06,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-g", "30", "-movflags", "+faststart", join(p.root, rel)]);
      o.authored.beats = o.authored.beats.map((b) => ((b.kind === "poster" && b.bg === "mono") || (b.kind === "punch" && b.mono) ? { ...b, monoSrc: rel } : b));
    }
  }

  const faces = loadFaces(id);
  const prevVersion = existsSync(sbFile(id)) ? Number((JSON.parse(readFileSync(sbFile(id), "utf8")) as { version?: number }).version ?? 0) : 0;
  const sb = buildStoryboard({ project, transcript: loadTranscript(id), faces, fills, graded, options: o }, prevVersion + 1);
  sb.checks = validateStoryboard(sb, faces, sb.checks);
  saveStoryboard(sb);
  writeFileSync(optFile, JSON.stringify(o, null, 2));
  const revoked = revokeApproval(id);

  if (project.status === "ingested") project = transition(project, "analyzed", "Транскрипт и анализ готовы");
  if (canTransition(project.mode, project.status, "storyboard_draft")) project = transition(project, "storyboard_draft", `Сториборд v${sb.version}`);
  saveProject(project);

  const errors = sb.checks.filter((c) => c.level === "error");
  out({
    id, version: sb.version, format: sb.format, platform: sb.platform, style: sb.style.preset, styleSource: sb.style.source, overrides: sb.style.overrides, grade: sb.grade, durationSec: sb.durationSec,
    scenes: sb.scenes.length, captions: sb.captions.length, behindText: sb.behindText.map((b) => b.text), sfx: sb.sfx.length,
    layouts: sb.layouts.map((l) => `${l.kind} ${l.start}-${l.end}`), icons: sb.icons.map((i) => `${i.name}:${i.word}`),
    approvalRevoked: revoked, errors: errors.length, warnings: sb.checks.length - errors.length,
    checks: sb.checks.map((c) => `${c.level.toUpperCase()}: ${c.message}`),
  });
});
