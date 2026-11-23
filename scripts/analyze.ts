/**
 * npm run analyze -- <id>
 * Face / head / mouth / person analysis of the main video + scene cuts (expert-video),
 * voice level (all modes). Environment and models are prepared automatically.
 * Writes work/faces.json and work/voice-level.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAnalysis } from "../src/analysis/python";
import { measureLevels } from "../src/audio/enhance";
import { loadProject, pathsFor } from "../src/core/store";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const project = loadProject(pos[0] ?? "");
  const p = pathsFor(project.id);
  const log = (s: string) => console.error(s);
  let faces: unknown = null;
  const video = project.assets.find((a) => a.role === "main-video");
  if (video) {
    faces = await runAnalysis([`analyze`, join(p.root, video.prepared), join(p.work, "faces.json"), "--fps", "5"], log);
  }
  const voice = project.assets.find((a) => a.id === project.voiceAssetId);
  const level = voice ? await measureLevels(join(p.root, voice.prepared)) : null;
  if (level) writeFileSync(join(p.work, "voice-level.json"), JSON.stringify(level, null, 2));
  out({ id: project.id, faces, voiceLevel: level });
});
