/**
 * npm run showcase -- <cmd> <id> [opts]
 *
 * Bespoke expert-video edit (storyboard/showcase.json, format src/showcase/spec.ts) for briefs the standard
 * planner cannot express: background replacement, layer reveal, silhouette contour, letters behind the person,
 * schema, timeline, comment field. Same discipline as the main pipeline:
 *   storyboard → user approves → render (hard gate: sha256 of showcase.json) → cover → qc → delivery.
 *
 *   storyboard <id>        stills at every shot (with safe-zone guides) → storyboard/contact-sheet.jpg + shotlist.md (+ checks)
 *   animatic <id>          540p motion+sound preview of the current version
 *   approve <id>           ONLY after the user's explicit words
 *   render <id> [--max-mb 90]  final 1080×1920 MP4 (−14 LUFS)
 *   frames <id> t1,t2,…    full-size stills at given seconds for self-checking (work/check-*.jpg)
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import { ensureSfx } from "../src/audio/sfx";
import { loudnormPass2, parseLoudnormJson } from "../src/audio/enhance";
import { loadProject, pathsFor, saveProject } from "../src/core/store";
import { transition, canTransition } from "../src/core/state";
import { renderMp4 } from "../src/render/renderer";
import { bundleFor, renderStills } from "../src/render/stills";
import { ShowcaseSchema, showcaseChecks, showcaseDuration, type Showcase } from "../src/showcase/spec";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const showcaseHash = (s: Showcase) => createHash("sha256").update(JSON.stringify({ ...s, version: 0 })).digest("hex");

function load(id: string) {
  const p = pathsFor(id);
  const file = join(p.storyboard, "showcase.json");
  const spec = ShowcaseSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  return { p, file, spec };
}

async function props(id: string, spec: Showcase, guides: boolean) {
  const p = pathsFor(id);
  await ensureSfx(p.root);
  const dir = join(p.root, spec.matteDir);
  const matteFrames = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".webp")).length : 0;
  return { spec, matteFrames, sfxDir: "work/sfx", guides };
}

function shotlistMd(spec: Showcase): string {
  const rows = spec.shots
    .map(
      (s, i) =>
        `## ${i + 1}-кадр · ${fmt(s.start)}–${fmt(s.end)}\n- **Экранда:** ${s.screen}\n- **Айтылады:** ${s.spoken || "—"}\n- **Мәтін шығады:** ${s.text || "—"}\n- **Кадр ішінде:** ${s.inside || "—"}\n- **Келесіге өту:** ${s.transition}\n`,
    )
    .join("\n");
  return `# Раскадровка v${spec.version}\n9:16 · 1080×1920 · ${showcaseDuration(spec).toFixed(1)} с · ${spec.shots.length} кадр\n\n«Монтажды бастау» — финал видео. «Кадрды өзгерту» — мысалы: «5-кадрды өзгерт: контур қалыңырақ».\n\n${rows}`;
}

main(async () => {
  const { pos, opt } = parseArgs();
  const [cmd, id = ""] = pos;
  const { p, file, spec: spec0 } = load(id);
  let spec = spec0;
  const stampFile = join(p.storyboard, "showcase-preview.json");
  const apprFile = join(p.storyboard, "showcase-approval.json");
  const log = (s: string) => console.error(s);

  if (cmd === "storyboard") {
    // Changed since the last preview → new version, approval revoked.
    const stamp = existsSync(stampFile) ? (JSON.parse(readFileSync(stampFile, "utf8")) as { hash: string; version: number }) : null;
    let revoked = false;
    if (stamp && stamp.hash !== showcaseHash(spec)) {
      spec = { ...spec, version: Math.max(spec.version, stamp.version + 1) };
      writeFileSync(file, JSON.stringify(spec, null, 1));
      if (existsSync(apprFile)) (copyFileSync(apprFile, apprFile + ".revoked"), writeFileSync(apprFile, "null"), (revoked = true));
    }
    const checks = showcaseChecks(spec);
    const dir = join(p.storyboard, "frames");
    mkdirSync(dir, { recursive: true });
    const serveUrl = await bundleFor(p.root);
    const pr = await props(id, spec, true);
    const jobs = spec.shots.map((s, i) => ({ frame: Math.round(s.keyT * spec.fps), output: join(dir, `shot-${String(i + 1).padStart(2, "0")}.jpg`), inputProps: pr }));
    log(`Кадры сториборда: ${jobs.length}…`);
    await renderStills({ serveUrl, compositionId: "Showcase", jobs, scale: 0.5 });
    const tw = 540, th = 960, cols = 3, labelH = 120, gap = 16;
    const rows = Math.ceil(jobs.length / cols);
    const Wd = cols * tw + (cols + 1) * gap;
    const header = `<svg width="${Wd}" height="150" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:Inter,sans-serif;fill:#F7F5F2}</style><text x="${gap}" y="64" class="t" font-size="50" font-weight="800">Раскадровка v${spec.version} · 9:16 · ${showcaseDuration(spec).toFixed(1)} с</text><text x="${gap}" y="116" class="t" font-size="26" fill-opacity="0.7">сары пунктир — қауіпсіз аймақ · қызыл — Reels батырмалары · сол жақ жоғарыда — секунд</text></svg>`;
    const comps: OverlayOptions[] = [{ input: Buffer.from(header), top: 0, left: 0 }];
    spec.shots.forEach((s, i) => {
      const x = gap + (i % cols) * (tw + gap);
      const y = 150 + Math.floor(i / cols) * (th + labelH + gap);
      comps.push({ input: jobs[i]!.output, top: y, left: x });
      const line = s.spoken.length > 34 ? s.spoken.slice(0, 33) + "…" : s.spoken;
      comps.push({ input: Buffer.from(`<svg width="${tw}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:Inter,sans-serif;fill:#F7F5F2}</style><text x="6" y="44" class="t" font-size="34" font-weight="800">${i + 1}. ${fmt(s.start)}–${fmt(s.end)}</text><text x="6" y="90" class="t" font-size="26" fill-opacity="0.85">${esc(line)}</text></svg>`), top: y + th + 4, left: x });
    });
    const sheet = join(p.storyboard, "contact-sheet.jpg");
    await sharp({ create: { width: Wd, height: 150 + rows * (th + labelH + gap) + gap, channels: 3, background: "#141414" } }).composite(comps).jpeg({ quality: 82 }).toFile(sheet);
    writeFileSync(join(p.storyboard, "shotlist.md"), shotlistMd(spec));
    writeFileSync(stampFile, JSON.stringify({ hash: showcaseHash(spec), version: spec.version, at: new Date().toISOString() }));
    out({ id, version: spec.version, approvalRevoked: revoked, contactSheet: sheet, shotlist: join(p.storyboard, "shotlist.md"), checks });
    return;
  }

  if (cmd === "frames") {
    const ts = (pos[2] ?? "").split(",").map(Number).filter((x) => Number.isFinite(x));
    const serveUrl = await bundleFor(p.root);
    const pr = await props(id, spec, !!opt.guides);
    const jobs = ts.map((t) => ({ frame: Math.round(t * spec.fps), output: join(p.work, `check-${t.toFixed(2)}.jpg`), inputProps: pr }));
    await renderStills({ serveUrl, compositionId: "Showcase", jobs, scale: Number(str(opt.scale) ?? 0.5) });
    out({ files: jobs.map((j) => j.output) });
    return;
  }

  if (cmd === "animatic") {
    const pr = await props(id, spec, false);
    const raw = join(p.work, "animatic-raw.mp4");
    await renderMp4({ compositionId: "Showcase", publicDir: p.root, inputProps: pr, output: raw, scale: 0.5, onProgress: () => {} });
    const dest = join(p.storyboard, "animatic.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "drawtext=text='ЭСКИЗ v" + spec.version + "':x=20:y=20:fontsize=28:fontcolor=white@0.7", "-c:v", "libx264", "-crf", "28", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dest]).catch(async () => {
      await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-c:v", "libx264", "-crf", "28", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", dest]);
    });
    out({ animatic: dest, version: spec.version });
    return;
  }

  if (cmd === "approve") {
    const stamp = existsSync(stampFile) ? (JSON.parse(readFileSync(stampFile, "utf8")) as { hash: string; version: number }) : null;
    if (!stamp || stamp.hash !== showcaseHash(spec)) throw new Error("Сначала покажите актуальную версию: npm run showcase -- storyboard <id>.");
    writeFileSync(apprFile, JSON.stringify({ version: spec.version, hash: showcaseHash(spec), approvedAt: new Date().toISOString() }, null, 2));
    out({ approved: spec.version });
    return;
  }

  if (cmd === "render") {
    const appr = existsSync(apprFile) ? (JSON.parse(readFileSync(apprFile, "utf8")) as { hash: string; version: number } | null) : null;
    if (!appr) throw new Error("Раскадровка не одобрена пользователем. Финальный рендер запрещён.");
    if (appr.hash !== showcaseHash(spec)) throw new Error(`Раскадровка изменилась после одобрения (одобрена v${appr.version}). Покажите новую версию и получите одобрение.`);
    const pr = await props(id, spec, false);
    const raw = join(p.work, "render-raw.mp4");
    const t0 = Date.now();
    let last = -1;
    await renderMp4({
      compositionId: "Showcase", publicDir: p.root, inputProps: pr, output: raw,
      onProgress: (x) => { const pc = Math.floor(x * 10); if (pc !== last) (last = pc), log(`Рендер: ${pc * 10}%`); },
    });
    const m1 = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", raw, "-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { maxBuffer: 64 << 20 });
    const meas = parseLoudnormJson(m1.stderr);
    mkdirSync(p.output, { recursive: true });
    const final = join(p.output, "final-video.mp4");
    await run("ffmpeg", ["-hide_banner", "-y", "-i", raw, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-af", loudnormPass2(meas, -14, -1), "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final], { maxBuffer: 64 << 20 });
    const maxMb = Number(str(opt["max-mb"]) ?? 0);
    if (maxMb > 0 && statSync(final).size > maxMb * 1e6) {
      const kbps = Math.floor(((maxMb * 8e6) / showcaseDuration(spec) - 200e3) / 1000);
      const tmp = join(p.work, "final-fit.mp4");
      await run("ffmpeg", ["-hide_banner", "-y", "-i", final, "-c:v", "libx264", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", tmp]);
      copyFileSync(tmp, final);
    }
    const renderSec = (Date.now() - t0) / 1000;
    writeFileSync(join(p.output, "render.json"), JSON.stringify({ kind: "showcase", version: spec.version, hash: showcaseHash(spec), renderedAt: new Date().toISOString(), renderSec }, null, 2));
    let project = loadProject(id);
    for (const s of ["storyboard_draft", "approved", "rendered"] as const) if (canTransition(project.mode, project.status, s)) project = transition(project, s, `showcase v${spec.version}`);
    saveProject(project);
    out({ final, version: spec.version, renderSec: Math.round(renderSec), sizeMb: +(statSync(final).size / 1e6).toFixed(1) });
    return;
  }
  throw new Error("Команды: storyboard | frames | animatic | approve | render");
});
