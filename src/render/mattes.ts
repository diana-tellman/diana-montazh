import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runAnalysis } from "../analysis/python";
import { pathsFor } from "../core/store";
import type { Beat, Storyboard } from "../storyboard/schema";

/**
 * Person cut-outs for "text behind the subject" and authored beats (background replacement,
 * white outline, depth-masked headlines). Overlapping ranges share one generated sequence.
 * Cached by range; injected into render props only — the storyboard file itself is unchanged.
 */
export async function withMattes(sb: Storyboard, log: (s: string) => void = () => {}): Promise<Storyboard> {
  const root = pathsFor(sb.projectId).root;
  const v = sb.visuals.find((x) => x.kind === "video" && x.src);
  if (!v?.src) return sb;
  type Need = { start: number; end: number; outline: boolean };
  const needs: Need[] = [];
  for (const b of sb.behindText) needs.push({ start: b.start, end: b.end, outline: false });
  for (const b of sb.beats) {
    if (b.kind === "cutout") needs.push({ start: b.start, end: b.end, outline: !!b.outline });
    if (b.kind === "headline" && b.behind) needs.push({ start: b.start, end: b.end, outline: false });
  }
  needs.sort((a, b) => a.start - b.start);
  const merged: Need[] = [];
  for (const n of needs) {
    const last = merged.at(-1);
    if (last && n.start <= last.end + 0.3) {
      last.end = Math.max(last.end, n.end);
      last.outline ||= n.outline;
    } else merged.push({ ...n });
  }
  const out: Array<Need & { dir: string }> = [];
  for (const m of merged) {
    const s0 = Math.max(0, m.start - 0.1);
    const s1 = m.end + 0.1;
    const rel = join("work", "matte", `r-${s0.toFixed(2)}-${s1.toFixed(2)}${m.outline ? "-o" : ""}`);
    const abs = join(root, rel);
    const need = Math.ceil((s1 - s0) * sb.fps) - 1;
    if (!existsSync(abs) || readdirSync(abs).filter((f) => !f.startsWith("o")).length < need) {
      log(`Вырезаю силуэт ${s0.toFixed(1)}–${s1.toFixed(1)} с${m.outline ? " + белый контур" : ""}…`);
      const args = ["matte", join(root, v.src), abs, "--start", s0.toFixed(3), "--end", s1.toFixed(3), "--fps", String(sb.fps)];
      if (m.outline) args.push("--outline", "14");
      await runAnalysis(args, log);
    }
    out.push({ ...m, start: s0, end: s1, dir: rel });
  }
  const find = (a: number, b: number) => out.find((m) => a >= m.start - 1e-6 && b <= m.end + 1e-6) ?? null;
  return {
    ...sb,
    behindText: sb.behindText.map((b) => { const m = find(b.start, b.end); return { ...b, matteDir: m?.dir ?? null, matteStart: m?.start ?? b.start }; }),
    beats: sb.beats.map((b): Beat => {
      if (b.kind !== "cutout" && !(b.kind === "headline" && b.behind)) return b;
      const m = find(b.start, b.end);
      return { ...b, matteDir: m?.dir ?? null, matteStart: m?.start ?? 0 };
    }),
  };
}
