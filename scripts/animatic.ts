/**
 * npm run animatic -- <id>
 * Fast motion preview of the CURRENT storyboard (540×960, all animations, mattes and SFX) so the user
 * can judge movement and sound BEFORE approving. Not a final render; no approval needed.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { pathsFor } from "../src/core/store";
import { withMattes } from "../src/render/mattes";
import { renderMp4 } from "../src/render/renderer";
import { loadStoryboard } from "../src/storyboard/store";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const sb = loadStoryboard(pos[0] ?? "");
  const p = pathsFor(sb.projectId);
  const log = (s: string) => console.error(s);
  const props = { storyboard: await withMattes(sb, log), guides: null, useMattes: true };
  const output = join(p.storyboard, `animatic-v${sb.version}.mp4`);
  const t0 = Date.now();
  await renderMp4({ compositionId: "Edit", publicDir: p.root, inputProps: props, output, scale: 0.5 });
  out({ animatic: output, version: sb.version, seconds: Math.round((Date.now() - t0) / 1000), sizeMb: Math.round(statSync(output).size / 1e5) / 10 });
});
