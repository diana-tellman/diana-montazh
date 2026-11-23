/**
 * npm run keyframes -- <id> <t1> <t2> …  — render real frames of the current storyboard at given times
 * (with mattes, without guides) into storyboard/keys/ and a labelled sheet storyboard/keys.jpg.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { pathsFor } from "../src/core/store";
import { withMattes } from "../src/render/mattes";
import { bundleFor, renderStills } from "../src/render/stills";
import { loadStoryboard } from "../src/storyboard/store";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const [id, ...ts] = pos;
  const sb = loadStoryboard(id ?? "");
  const p = pathsFor(sb.projectId);
  const dir = join(p.storyboard, "keys");
  mkdirSync(dir, { recursive: true });
  const props = { storyboard: await withMattes(sb, (s) => console.error(s)), useMattes: true, guides: null };
  const jobs = ts.map(Number).map((t, i) => ({ frame: Math.round(t * sb.fps), inputProps: props, output: join(dir, `k${String(i + 1).padStart(2, "0")}.jpg`) }));
  await renderStills({ serveUrl: await bundleFor(p.root), compositionId: "Edit", jobs, scale: 0.4 });
  const tw = Math.round(sb.width * 0.4);
  const th = Math.round(sb.height * 0.4);
  const cols = 4;
  const comps: OverlayOptions[] = jobs.flatMap((j, i) => {
    const x = 10 + (i % cols) * (tw + 10);
    const y = 10 + Math.floor(i / cols) * (th + 50);
    const svg = `<svg width="${tw}" height="44" xmlns="http://www.w3.org/2000/svg"><text x="4" y="32" font-family="Inter" font-size="30" font-weight="800" fill="#fff">${i + 1} · ${ts[i]} с</text></svg>`;
    return [{ input: j.output, left: x, top: y }, { input: Buffer.from(svg), left: x, top: y + th + 4 }];
  });
  const rows = Math.ceil(jobs.length / cols);
  const sheet = join(p.storyboard, "keys.jpg");
  await sharp({ create: { width: cols * (tw + 10) + 10, height: rows * (th + 50) + 10, channels: 3, background: "#171719" } }).composite(comps).jpeg({ quality: 85 }).toFile(sheet);
  out({ sheet, frames: jobs.length });
});
