/**
 * npm run sfx-demo -- [theme]   — listen to every sound of a theme (out/sfx-demo-<theme>.mp3 + list).
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildSfx, SFX_NAMES, SFX_THEMES, type SfxTheme } from "../src/audio/sfx";
import { ROOT } from "../src/core/store";
import { main, out, parseArgs } from "./_cli";

const run = promisify(execFile);

main(async () => {
  const theme = (parseArgs().pos[0] ?? "cinematic") as SfxTheme;
  if (!SFX_THEMES.includes(theme)) throw new Error(`Темы: ${SFX_THEMES.join(", ")}`);
  const dir = join(ROOT, "out", `sfx-${theme}`);
  mkdirSync(dir, { recursive: true });
  const list: string[] = [];
  const inputs: string[] = [];
  let t = 0.5;
  for (const name of SFX_NAMES) {
    const f = join(dir, `${name}.wav`);
    const src = await buildSfx(name, theme, f);
    list.push(`${t.toFixed(1)} с — ${name} (${src})`);
    inputs.push(f);
    t += 2;
  }
  const filters = inputs.map((_, i) => `[${i}:a]adelay=${500 + i * 2000}:all=1[a${i}]`).join(";");
  const mp3 = join(ROOT, "out", `sfx-demo-${theme}.mp3`);
  await run("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", `${filters};${inputs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${inputs.length}:normalize=0[o]`, "-map", "[o]", "-b:a", "192k", mp3]);
  writeFileSync(mp3.replace(/\.mp3$/, ".txt"), list.join("\n"));
  out({ mp3, list });
});
