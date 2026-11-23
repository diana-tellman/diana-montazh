/**
 * npm run render -- <id> [--max-mb 95]
 * Final render. HARD GATE: only the approved storyboard version (hash match) can be rendered.
 * Then: audio loudness to −14 LUFS / −1 dBTP (voice untouched otherwise), fast-start MP4.
 */
import { execFile } from "node:child_process";
import { copyFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadProject, pathsFor, saveProject } from "../src/core/store";
import { transition } from "../src/core/state";
import { loudnormPass2, parseLoudnormJson } from "../src/audio/enhance";
import { withMattes } from "../src/render/mattes";
import { renderMp4 } from "../src/render/renderer";
import { loadStoryboard, readApproval, storyboardHash } from "../src/storyboard/store";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);

main(async () => {
  const { pos, opt } = parseArgs();
  const id = pos[0] ?? "";
  const p = pathsFor(id);
  const sb = loadStoryboard(id);
  const approval = readApproval(id);
  const hash = storyboardHash(sb);
  if (!approval) throw new Error("Сториборд не одобрен пользователем. Финальный рендер запрещён.");
  if (approval.hash !== hash) throw new Error(`Сториборд изменился после одобрения (одобрена v${approval.version}). Покажите новую версию и получите одобрение.`);

  const log = (s: string) => console.error(s);
  const props = { storyboard: await withMattes(sb, log), guides: null, useMattes: true };
  const raw = join(p.work, "render-raw.mp4");
  const t0 = Date.now();
  let last = -1;
  await renderMp4({
    compositionId: "Edit", publicDir: p.root, inputProps: props, output: raw,
    onProgress: (x) => {
      const pc = Math.floor(x * 10);
      if (pc !== last) (last = pc), log(`Рендер: ${pc * 10}%`);
    },
  });
  const renderSec = (Date.now() - t0) / 1000;

  // Final loudness (two-pass, linear) → -14 LUFS integrated, -1 dBTP.
  const m1 = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", raw, "-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { maxBuffer: 64 << 20 });
  const meas = parseLoudnormJson(m1.stderr);
  const final = join(p.output, "final-video.mp4");
  const maxMb = Number(str(opt["max-mb"]) ?? 0);
  const vArgs = ["-c:v", "copy"];
  await run("ffmpeg", ["-hide_banner", "-y", "-i", raw, "-map", "0:v:0", "-map", "0:a:0", ...vArgs, "-af", loudnormPass2(meas, -14, -1), "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final], { maxBuffer: 64 << 20 });
  if (maxMb > 0 && statSync(final).size > maxMb * 1e6) {
    const kbps = Math.floor(((maxMb * 8e6) / sb.durationSec - 200e3) / 1000);
    log(`Файл больше ${maxMb} МБ — пережимаю видео до ~${kbps} кбит/с…`);
    const tmp = join(p.work, "final-fit.mp4");
    await run("ffmpeg", ["-hide_banner", "-y", "-i", final, "-c:v", "libx264", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", tmp]);
    copyFileSync(tmp, final);
  }
  writeFileSync(join(p.output, "render.json"), JSON.stringify({ version: sb.version, hash, renderedAt: new Date().toISOString(), renderSec }, null, 2));
  let project = loadProject(id);
  project = transition(project, "rendered", `Рендер v${sb.version} за ${Math.round(renderSec)} с`);
  saveProject(project);
  out({ id, final, version: sb.version, renderSec: Math.round(renderSec), sizeMb: Math.round(statSync(final).size / 1e5) / 10 });
});
