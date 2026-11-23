/**
 * npm run approve -- <id>
 * Records the user's explicit approval of the CURRENT storyboard version (bound by hash).
 * Refuses if the user has not been shown this exact version or if it has blocking errors.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadProject, saveProject } from "../src/core/store";
import { transition } from "../src/core/state";
import { approvalFile, loadStoryboard, previewStamp, storyboardHash } from "../src/storyboard/store";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const id = pos[0] ?? "";
  const sb = loadStoryboard(id);
  const hash = storyboardHash(sb);
  const stamp = existsSync(previewStamp(id)) ? (JSON.parse(readFileSync(previewStamp(id), "utf8")) as { hash: string; version: number }) : null;
  if (!stamp || stamp.hash !== hash) throw new Error("Эту версию сториборда пользователь ещё не видел: сначала npm run storyboard -- <id> и показать результат.");
  const errors = sb.checks.filter((c) => c.level === "error");
  if (errors.length) throw new Error(`В сториборде есть ошибки, их нужно исправить до одобрения:\n- ${errors.map((e) => e.message).join("\n- ")}`);
  const approval = { version: sb.version, hash, approvedAt: new Date().toISOString() };
  writeFileSync(approvalFile(id), JSON.stringify(approval, null, 2));
  let project = loadProject(id);
  if (project.status !== "approved") project = transition(project, "approved", `Одобрен сториборд v${sb.version}`);
  saveProject(project);
  out({ id, approved: true, ...approval });
});
