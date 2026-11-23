/**
 * npm run storyboard -- <id>
 *
 * Renders the visual storyboard from the REAL composition (same code as the final render):
 * one frame per scene on the real video frames, with safe-zone and face guides.
 * Outputs storyboard/contact-sheet.jpg (for the phone) and storyboard/storyboard.html.
 * If storyboard.json was edited since the last preview, the version is bumped and approval revoked.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { loadProject, pathsFor, saveProject } from "../src/core/store";
import { canTransition, transition } from "../src/core/state";
import { STYLES } from "../src/design/styles";
import { safeZone } from "../src/layout/safeZones";
import { faceBoxesAt, validateStoryboard } from "../src/plan/validate";
import { withMattes } from "../src/render/mattes";
import { bundleFor, renderStills } from "../src/render/stills";
import type { Storyboard } from "../src/storyboard/schema";
import { loadFaces, loadStoryboard, previewStamp, revokeApproval, saveStoryboard, storyboardHash } from "../src/storyboard/store";
import { existsSync } from "node:fs";
import { main, out, parseArgs } from "./_cli";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Wrap text to lines of at most n characters on word boundaries. */
const wrap = (text: string, n: number, maxLines: number) => {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > n) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines.splice(maxLines - 1, lines.length, lines.slice(maxLines - 1).join(" ").slice(0, n - 1) + "…");
  return lines;
};
const fmtT = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

main(async () => {
  const { pos } = parseArgs();
  const id = pos[0] ?? "";
  let project = loadProject(id);
  const p = pathsFor(id);
  const faces = loadFaces(id);
  let sb = loadStoryboard(id);

  // Manual edits since the last preview → new version, approval revoked.
  const hash = storyboardHash(sb);
  const stamp = existsSync(previewStamp(id)) ? (JSON.parse(readFileSync(previewStamp(id), "utf8")) as { hash: string; version: number }) : null;
  let revoked = false;
  if (stamp && stamp.hash !== hash && stamp.version >= sb.version) sb = { ...sb, version: stamp.version + 1 };
  if (stamp && stamp.hash !== hash) revoked = revokeApproval(id);
  sb = { ...sb, updatedAt: new Date().toISOString(), checks: validateStoryboard(sb, faces, sb.checks) };
  for (const s of sb.scenes) s.checks = sb.checks.filter((c) => c.at !== null && c.at >= s.start && c.at < s.end);
  saveStoryboard(sb);

  const dir = join(p.storyboard, "frames");
  mkdirSync(dir, { recursive: true });
  const log = (s: string) => console.error(s);
  const withM = await withMattes(sb, log);
  log("Рендер кадров сториборда…");
  const serveUrl = await bundleFor(p.root);
  const jobs = sb.scenes.map((s) => ({
    frame: Math.round(s.keyT * sb.fps),
    output: join(dir, `scene-${String(s.index).padStart(2, "0")}.jpg`),
    inputProps: { storyboard: withM, useMattes: true, guides: { faceBoxes: faceBoxesAt(sb, faces, s.keyT), label: `${s.index} · ${fmtT(s.keyT)}` } },
  }));
  await renderStills({ serveUrl, compositionId: "Edit", jobs, scale: 0.5 });

  // Contact sheet for the phone: 3 columns, caption under each frame.
  const tw = Math.round(sb.width * 0.5);
  const th = Math.round(sb.height * 0.5);
  const cols = sb.scenes.length <= 4 ? 2 : 3;
  const labelH = 150;
  const gap = 18;
  const rows = Math.ceil(jobs.length / cols);
  const W = cols * tw + (cols + 1) * gap;
  const H = 190 + rows * (th + labelH + gap) + gap;
  const header = `<svg width="${W}" height="190" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:Inter,sans-serif;fill:#F7F5F2}</style>
    <text x="${gap}" y="70" class="t" font-size="54" font-weight="800">Сториборд v${sb.version} · ${sb.format} · ${STYLES[sb.style.preset].label}</text>
    <text x="${gap}" y="122" class="t" font-size="30" fill-opacity="0.75">${esc(`${sb.durationSec.toFixed(1)} с · ${sb.scenes.length} сцен · ${sb.captions.length} субтитров`)}</text>
    <text x="${gap}" y="160" class="t" font-size="26" fill-opacity="0.6">${esc("жёлтая рамка — безопасная зона · зелёная — лицо · красное — интерфейс соцсети")}</text></svg>`;
  const comps: OverlayOptions[] = [{ input: Buffer.from(header), top: 0, left: 0 }];
  sb.scenes.forEach((s, i) => {
    const x = gap + (i % cols) * (tw + gap);
    const y = 190 + Math.floor(i / cols) * (th + labelH + gap);
    comps.push({ input: jobs[i]!.output, top: y, left: x });
    const bad = s.checks.some((c) => c.level === "error") ? "⚠ " : s.checks.length ? "• " : "✓ ";
    const lines = wrap(s.onScreenText.replace(/\*/g, "").replace(/ \| /g, " · ").replace(/ \/ /g, " "), Math.floor(tw / (sb.style.preset === "kinetic" || sb.style.preset === "lime" ? 18 : 15)), 2);
    const svg = `<svg width="${tw}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:Inter,sans-serif;fill:#F7F5F2}</style>
      <text x="6" y="44" class="t" font-size="36" font-weight="800">${esc(`${bad}${s.index}. ${fmtT(s.start)}–${fmtT(s.end)}`)}</text>
      ${lines.map((l, k) => `<text x="6" y="${92 + k * 38}" class="t" font-size="27" fill-opacity="0.85">${esc(l)}</text>`).join("")}</svg>`;
    comps.push({ input: Buffer.from(svg), top: y + th + 4, left: x });
  });
  const sheet = join(p.storyboard, "contact-sheet.jpg");
  await sharp({ create: { width: W, height: H, channels: 3, background: "#141414" } }).composite(comps).jpeg({ quality: 82 }).toFile(sheet);

  // Self-contained mobile HTML.
  const st = STYLES[sb.style.preset];
  const sz = safeZone(sb.platform);
  const img = (f: string) => `data:image/jpeg;base64,${readFileSync(f).toString("base64")}`;
  const checkLi = (c: { level: string; message: string }) => `<li class="${c.level}">${c.level === "error" ? "⛔" : c.level === "warn" ? "⚠️" : "✅"} ${esc(c.message)}</li>`;
  const html = `<!doctype html><html lang="kk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Сториборд v${sb.version}</title><style>
:root{--bg:#141414;--card:#1e1e1e;--fg:#F7F5F2;--mut:#b9b5ae;--acc:${sb.style.colors.accent}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,Inter,sans-serif;padding:16px}
h1{font-size:22px;margin:0 0 4px}.meta{color:var(--mut);font-size:14px;margin-bottom:16px}
.card{background:var(--card);border-radius:16px;padding:12px;margin:0 0 16px}
.card img{width:100%;border-radius:10px;display:block}.k{color:var(--mut);font-size:13px;margin-top:8px}
.txt{font-weight:700;margin-top:6px}ul{padding-left:18px;margin:6px 0}li{margin:2px 0}.error{color:#ff8a8a}.warn{color:#ffd27a}
.ask{border:1px solid var(--acc);border-radius:16px;padding:12px}code{background:#2a2a2a;padding:1px 6px;border-radius:6px}
</style></head><body>
<h1>Сториборд v${sb.version}</h1>
<div class="meta">${sb.format} · ${sb.width}×${sb.height} · ${sb.durationSec.toFixed(1)} с · стиль ${esc(st.label)} · цвета: текст ${sb.style.colors.text}, акцент ${sb.style.colors.accent} · зона: ${esc(sz.label)}</div>
<div class="card"><b>Проверки</b><ul>${sb.checks.length ? sb.checks.map(checkLi).join("") : "<li>✅ Всё в порядке: текст в безопасной зоне и не закрывает лицо.</li>"}</ul>
<div class="k">${esc(sb.transcriptNote)}</div></div>
${sb.scenes.map((s, i) => `<div class="card"><img src="${img(jobs[i]!.output)}" alt="Сцена ${s.index}">
<div class="txt">${s.index}. ${fmtT(s.start)}–${fmtT(s.end)} · ${esc(s.title)}</div>
<div class="k">Текст на экране</div><div>${esc(s.onScreenText).replace(/\*([^*]+)\*/g, "<b style='color:var(--acc)'>$1</b>") || "—"}</div>
<div class="k">Камера</div><div>${esc(s.camera)}</div>
<div class="k">Анимация</div><div>${esc(s.animation)}</div>
<div class="k">Звук</div><div>${esc(s.sfx)}</div>
${s.checks.length ? `<ul>${s.checks.map(checkLi).join("")}</ul>` : ""}</div>`).join("")}
<div class="card ask"><b>Что дальше?</b><br>Напишите <b>«Мақұлдаймын / Одобряю»</b> — и я сделаю финальное видео и обложку.<br>
Или правку: «3-сахнадағы мәтінді жоғары көтер», «Сделай текст красным и белым», «Убери анимацию за головой», «Исправь слово … на …».</div>
</body></html>`;
  writeFileSync(join(p.storyboard, "storyboard.html"), html);
  writeFileSync(previewStamp(id), JSON.stringify({ hash: storyboardHash(sb), version: sb.version, at: new Date().toISOString() }));

  const changed = !!stamp && stamp.hash !== hash;
  if (changed && project.status !== "storyboard_draft" && canTransition(project.mode, project.status, "storyboard_draft")) project = transition(project, "storyboard_draft", `Сториборд v${sb.version} (правка)`);
  saveProject(project);
  out({
    id, version: sb.version, approvalRevoked: revoked, contactSheet: sheet, html: join(p.storyboard, "storyboard.html"),
    errors: sb.checks.filter((c) => c.level === "error").map((c) => c.message), warnings: sb.checks.filter((c) => c.level === "warn").map((c) => c.message),
  });
});
