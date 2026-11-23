/** npm run status -- <id>   — project state, next step, assets. */
import { loadProject } from "../src/core/store";
import { flowFor } from "../src/core/state";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const id = pos[0];
  if (!id) throw new Error("Укажите id проекта: npm run status -- <id>");
  const p = loadProject(id);
  const flow = flowFor(p.mode);
  out({
    id: p.id, mode: p.mode, status: p.status, next: flow[flow.indexOf(p.status) + 1] ?? null, styleRequest: p.styleRequest,
    assets: p.assets.map((a) => ({ id: a.id, role: a.role, prepared: a.prepared })), history: p.history,
  });
});
