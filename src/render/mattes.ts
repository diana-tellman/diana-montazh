import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runAnalysis } from "../analysis/python";
import { pathsFor } from "../core/store";
import type { Storyboard } from "../storyboard/schema";

/**
 * Person cut-outs for "text behind the subject". Generated per item (cached by timing)
 * and injected into render props only — the storyboard file itself is unchanged.
 */
export async function withMattes(sb: Storyboard, log: (s: string) => void = () => {}): Promise<Storyboard> {
  const root = pathsFor(sb.projectId).root;
  const behindText = [];
  for (const b of sb.behindText) {
    const v = sb.visuals.find((x) => b.start >= x.start && b.start < x.end);
    if (!v || v.kind !== "video" || !v.src || b.front) {
      behindText.push({ ...b, matteDir: null });
      continue;
    }
    const s0 = v.srcStart + (b.start - v.start);
    const s1 = v.srcStart + (b.end - v.start);
    const rel = join("work", "matte", `${b.id}-${s0.toFixed(2)}-${s1.toFixed(2)}`);
    const abs = join(root, rel);
    const need = Math.ceil((s1 - s0) * sb.fps) - 1;
    if (!existsSync(abs) || readdirSync(abs).length < need) {
      log(`Вырезаю силуэт для «${b.text}»…`);
      await runAnalysis(["matte", join(root, v.src), abs, "--start", s0.toFixed(3), "--end", s1.toFixed(3), "--fps", String(sb.fps)], log);
    }
    behindText.push({ ...b, matteDir: rel });
  }
  return { ...sb, behindText };
}
