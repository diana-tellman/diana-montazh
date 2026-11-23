import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FONT_CLASSES } from "../design/fontNames";
import { resolveColor, type StyleOverrides } from "../design/styles";
import type { PlanOptions } from "./planner";

export const SIZE: Record<string, number> = { small: 0.04, medium: 0.048, large: 0.058 };

type RefStyle = Partial<{
  source: string; font: string; weight: number; uppercase: boolean; size: string; textColor: string; accentColor: string; onAccent: string;
  position: string; wordsPerPhrase: number; activeWord: string; upcoming: string; backdrop: string; animation: string;
  behindText: boolean; icons: boolean; layout: string; progressBar: boolean; sfx: boolean; grade: boolean; gradeStrength: number; notes: string;
}>;

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const color = (v: unknown) => {
  if (typeof v !== "string" || !v) return undefined;
  try {
    return resolveColor(v);
  } catch {
    return undefined;
  }
};

/** reference-style.json (filled by Claude) + measured analysis → plan options. Null fields keep defaults. */
export function referenceOptions(projectRoot: string, storyboardDir: string, workDir: string): Partial<PlanOptions> {
  const f = join(storyboardDir, "reference-style.json");
  if (!existsSync(f)) throw new Error("Нет reference-style.json: сначала npm run reference -- <id> <видео> и заполнить файл.");
  const r = JSON.parse(readFileSync(f, "utf8")) as RefStyle;
  const ov: StyleOverrides = {};
  const font = r.font ? FONT_CLASSES[r.font] : undefined;
  if (font) ov.font = font;
  if (typeof r.weight === "number") ov.weight = Math.max(300, Math.min(900, Math.round(r.weight / 100) * 100));
  if (typeof r.uppercase === "boolean") ov.uppercase = r.uppercase;
  if (r.size && SIZE[r.size]) ov.size = SIZE[r.size];
  if (typeof r.wordsPerPhrase === "number") {
    ov.maxWordsPerPhrase = Math.max(1, Math.min(6, Math.round(r.wordsPerPhrase)));
    ov.maxCharsPerLine = ov.maxWordsPerPhrase <= 2 ? 14 : ov.maxWordsPerPhrase <= 4 ? 20 : 26;
  }
  const active = pick(r.activeWord, ["pill", "color", "scale", "underline"] as const);
  if (active) ov.active = active;
  const up = pick(r.upcoming, ["dim", "hidden", "visible"] as const);
  if (up) ov.upcoming = up;
  const bd = pick(r.backdrop, ["shadow", "glass", "none"] as const);
  if (bd) ov.backdrop = bd;
  const en = pick(r.animation, ["pop", "rise", "fade", "slide"] as const);
  if (en) ov.enter = en;

  const o: Partial<PlanOptions> = { styleOverrides: ov, styleSource: `референс: ${r.source ?? "видео"}` };
  const colors = { text: color(r.textColor), accent: color(r.accentColor), onAccent: color(r.onAccent) };
  o.colors = Object.fromEntries(Object.entries(colors).filter(([, v]) => v)) as PlanOptions["colors"];
  const pos = pick(r.position, ["auto", "top", "middle", "lower", "bottom"] as const);
  if (pos) o.captionPosition = pos;
  if (typeof r.behindText === "boolean") o.behindText = r.behindText;
  if (typeof r.icons === "boolean") o.icons = r.icons;
  if (typeof r.progressBar === "boolean") o.progressBar = r.progressBar;
  if (typeof r.sfx === "boolean") o.sfx = r.sfx;
  const lay = pick(r.layout, ["auto", "full", "circle", "split"] as const);
  if (lay) o.layout = lay;

  const af = join(workDir, "reference", "analysis.json");
  if (existsSync(af)) {
    const a = JSON.parse(readFileSync(af, "utf8")) as { suggestedEnergy?: number };
    if (a.suggestedEnergy === 0 || a.suggestedEnergy === 1 || a.suggestedEnergy === 2) o.cameraEnergy = a.suggestedEnergy;
  }
  const lut = join(workDir, "reference", "grade.cube");
  o.grade = r.grade !== false && existsSync(lut) ? { lut: relative(projectRoot, lut), strength: r.gradeStrength ?? 0.85, from: r.source ?? "reference" } : null;
  return o;
}
