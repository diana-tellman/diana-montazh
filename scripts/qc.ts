/**
 * npm run qc -- <id>
 * Automatic quality control of the delivered files + a frame sheet for visual review.
 * Writes output/quality-report.json and output/quality-report.md; output/qc-frames.jpg for Claude to look at.
 */
import { execFile } from "node:child_process";
import { existsSync, openSync, readFileSync, readSync, closeSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { measureLevels } from "../src/audio/enhance";
import { probe } from "../src/core/media";
import { loadProject, pathsFor, saveProject } from "../src/core/store";
import { canTransition, transition } from "../src/core/state";
import { loadStoryboard, readApproval, storyboardHash } from "../src/storyboard/store";
import { main, out, parseArgs } from "./_cli";

const run = promisify(execFile);
type Item = { ok: boolean; name: string; detail: string };

function moovFirst(file: string): boolean {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(256 * 1024);
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const moov = buf.indexOf("moov");
  const mdat = buf.indexOf("mdat");
  return moov >= 0 && (mdat < 0 || moov < mdat);
}

main(async () => {
  const { pos } = parseArgs();
  const id = pos[0] ?? "";
  const p = pathsFor(id);
  const sb = loadStoryboard(id);
  const final = join(p.output, "final-video.mp4");
  const cover = join(p.output, "cover.png");
  const items: Item[] = [];
  const add = (ok: boolean, name: string, detail: string) => items.push({ ok, name, detail });

  const approval = readApproval(id);
  const rendered = existsSync(join(p.output, "render.json")) ? (JSON.parse(readFileSync(join(p.output, "render.json"), "utf8")) as { hash: string; version: number }) : null;
  add(!!approval && approval.hash === storyboardHash(sb), "Сториборд одобрен", approval ? `v${approval.version}` : "нет одобрения");
  add(!!rendered && rendered.hash === approval?.hash, "Видео соответствует одобренной версии", rendered ? `рендер v${rendered.version}` : "нет рендера");
  const sbErrors = sb.checks.filter((c) => c.level === "error");
  add(sbErrors.length === 0, "Текст не перекрывает лицо, в безопасной зоне", sbErrors.length ? sbErrors.map((e) => e.message).join("; ") : "проверено по всем субтитрам");

  if (!existsSync(final)) add(false, "final-video.mp4", "файл не найден");
  else {
    const m = await probe(final);
    const v = m.video;
    add(v?.codec === "h264" && v.pixFmt === "yuv420p", "Кодек H.264 yuv420p", `${v?.codec} ${v?.pixFmt}`);
    add(v?.width === sb.width && v.height === sb.height, "Разрешение", `${v?.width}×${v?.height} (нужно ${sb.width}×${sb.height})`);
    add(!!v && Math.abs(v.fps - sb.fps) < 0.05 && !v.variableFrameRate, "Частота кадров", `${v?.fps} fps`);
    add(Math.abs(m.durationSec - sb.durationSec) < 0.15, "Длительность = длительности голоса", `${m.durationSec.toFixed(2)} с / ${sb.durationSec.toFixed(2)} с`);
    add(m.audio?.codec === "aac" && m.audio.sampleRate === 48000, "Звук AAC 48 кГц", `${m.audio?.codec} ${m.audio?.sampleRate}`);
    add(v?.colorPrimaries === "bt709" || v?.colorPrimaries === "unknown", "Цвет SDR BT.709", v?.colorPrimaries ?? "");
    add(moovFirst(final), "Быстрый старт (faststart)", "moov в начале файла");
    const lv = await measureLevels(final);
    add(lv.integratedLufs > -15.5 && lv.integratedLufs < -12.5, "Громкость −14 LUFS", `${lv.integratedLufs.toFixed(1)} LUFS`);
    add(lv.truePeakDb <= -0.8, "Пики ≤ −1 dBTP", `${lv.truePeakDb.toFixed(1)} dBTP`);
    add(lv.clippedSamples === 0, "Нет клиппинга", `${lv.clippedSamples} сэмплов`);
    add(m.sizeBytes < 250e6, "Размер файла", `${(m.sizeBytes / 1e6).toFixed(1)} МБ`);

    // Frame sheet for visual review (Claude must look at it).
    const fdir = join(p.work, "qc");
    mkdirSync(fdir, { recursive: true });
    const n = 6;
    const tiles: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * m.durationSec) / n;
      const f = join(fdir, `f${i}.jpg`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", final, "-frames:v", "1", "-vf", "scale=360:-2", f]);
      tiles.push(f);
    }
    const meta = await sharp(tiles[0]!).metadata();
    const tw = meta.width!;
    const th = meta.height!;
    await sharp({ create: { width: tw * 3 + 40, height: th * 2 + 30, channels: 3, background: "#141414" } })
      .composite(tiles.map((f, i) => ({ input: f, left: 10 + (i % 3) * (tw + 10), top: 10 + Math.floor(i / 3) * (th + 10) })))
      .jpeg({ quality: 85 })
      .toFile(join(p.output, "qc-frames.jpg"));
  }

  if (!existsSync(cover)) add(false, "Обложка cover.png", "не найдена");
  else {
    const c = await sharp(cover).metadata();
    add(c.width === sb.width && c.height === sb.height, "Обложка cover.png", `${c.width}×${c.height}`);
  }

  const kz = /[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/u.test(sb.captions.flatMap((c) => c.lines.flat().map((w) => w.text)).join(""));
  const manual = [
    "Посмотреть qc-frames.jpg: текст читается, не обрезан, не на лице.",
    "Плавность анимаций и смены планов — посмотреть видео целиком.",
    "Синхронизация субтитров с голосом (тайминг слов оценочный).",
    kz ? "Казахские буквы отображаются правильно (шрифты проверены на Ә Ғ Қ Ң Ө Ұ Ү Һ І)." : "Правильность текста субтитров.",
  ];
  const ok = items.every((i) => i.ok);
  const report = { id, version: sb.version, ok, checkedAt: new Date().toISOString(), automatic: items, manualReview: manual };
  writeFileSync(join(p.output, "quality-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(p.output, "quality-report.md"),
    `# Отчёт о качестве — v${sb.version}\n\n${items.map((i) => `- ${i.ok ? "✅" : "❌"} **${i.name}** — ${i.detail}`).join("\n")}\n\n## Требует просмотра\n${manual.map((m) => `- 👀 ${m}`).join("\n")}\n`,
  );
  let project = loadProject(id);
  if (ok && canTransition(project.mode, project.status, "qc_passed")) project = transition(project, "qc_passed", "QC пройден");
  saveProject(project);
  out({ id, ok, failed: items.filter((i) => !i.ok), frames: join(p.output, "qc-frames.jpg"), report: join(p.output, "quality-report.md") });
});
