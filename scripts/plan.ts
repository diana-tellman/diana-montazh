/**
 * npm run plan -- <id> [--style brand|minimal|kinetic|glass|lime] [--format 9:16|16:9|4:5|1:1]
 *   [--platform reels|stories|shorts|tiktok|feed|square|youtube] [--text <color>] [--accent <color>]
 *   [--position auto|top|middle|bottom] [--no-behind] [--no-sfx] [--no-progress] [--energy 0|1|2]
 *
 * Builds the edit plan (storyboard.json) from the transcript, face analysis and options.
 * Runs analysis/transcription automatically if they are missing. Any re-plan revokes approval.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { ensureSfx } from "../src/audio/sfx";
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
import { StoryboardSchema } from "../src/storyboard/schema";
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
  const prev: PlanOptions = existsSync(optFile) ? { ...DEFAULT_OPTIONS, ...JSON.parse(readFileSync(optFile, "utf8")) } : { ...DEFAULT_OPTIONS };
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
    colors: {
      ...(str(opt.style) ? {} : prev.colors),
      ...(str(opt.text) ? { text: resolveColor(str(opt.text)!) } : {}),
      ...(str(opt.accent) ? { accent: resolveColor(str(opt.accent)!) } : {}),
      ...(str(opt["on-accent"]) ? { onAccent: resolveColor(str(opt["on-accent"])!) } : {}),
    },
  };
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
  await ensureSfx(p.root);

  const faces = loadFaces(id);
  const prevVersion = existsSync(sbFile(id)) ? StoryboardSchema.parse(JSON.parse(readFileSync(sbFile(id), "utf8"))).version : 0;
  const sb = buildStoryboard({ project, transcript: loadTranscript(id), faces, fills, options: o }, prevVersion + 1);
  sb.checks = validateStoryboard(sb, faces, sb.checks);
  saveStoryboard(sb);
  writeFileSync(optFile, JSON.stringify(o, null, 2));
  const revoked = revokeApproval(id);

  if (project.status === "ingested") project = transition(project, "analyzed", "Транскрипт и анализ готовы");
  if (canTransition(project.mode, project.status, "storyboard_draft")) project = transition(project, "storyboard_draft", `Сториборд v${sb.version}`);
  saveProject(project);

  const errors = sb.checks.filter((c) => c.level === "error");
  out({
    id, version: sb.version, format: sb.format, platform: sb.platform, style: sb.style.preset, durationSec: sb.durationSec,
    scenes: sb.scenes.length, captions: sb.captions.length, behindText: sb.behindText.map((b) => b.text), sfx: sb.sfx.length,
    approvalRevoked: revoked, errors: errors.length, warnings: sb.checks.length - errors.length,
    checks: sb.checks.map((c) => `${c.level.toUpperCase()}: ${c.message}`),
  });
});
