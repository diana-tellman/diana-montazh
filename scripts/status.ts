/** npm run status -- <id>   — project state, next allowed step. */
import { loadProject } from "../src/core/store";
import { flowFor } from "../src/core/state";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const id = pos[0];
  if (!id) throw new Error("Укажите id проекта: npm run status -- <id>");
  const p = loadProject(id);
  const flow = flowFor(p.mode);
  const next = flow[flow.indexOf(p.status) + 1] ?? null;
  out({ id: p.id, mode: p.mode, status: p.status, next, flow, voice: p.voice, history: p.history });
});
