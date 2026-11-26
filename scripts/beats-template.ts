/**
 * npm run beats-template -- <id> [--captions] [--force]
 * Starter storyboard/beats.json built from the transcript and face analysis: one editorial poster per
 * phrase (key word in bold sans, the rest as label / italic accent), placed above the head when there is
 * room, otherwise in the lower third; matching SFX. Claude then refines it by the meaning of the speech
 * (skill editorial-motion) — this file is a starting point, not the final design.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, pathsFor } from "../src/core/store";
import { loadFaces, loadTranscript } from "../src/storyboard/store";
import { main, out, parseArgs } from "./_cli";

const clean = (w: string) => w.replace(/[*«»"]/g, "");
const bare = (w: string) => clean(w).replace(/[.,!?;:…]+$/, "");

main(async () => {
  const { pos, opt } = parseArgs();
  const id = pos[0] ?? "";
  loadProject(id);
  const p = pathsFor(id);
  const tr = loadTranscript(id);
  const faces = loadFaces(id);
  const words = tr.segments.flatMap((s) => s.words.map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000, emph: /^\*.*\*/.test(w.text.replace(/[.,!?;:»"]+$/, "")) })));
  // Phrases: split on sentence punctuation / commas / pauses, max 6 words.
  const phrases: (typeof words)[] = [];
  let cur: typeof words = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[.!?…,;:]$/.test(clean(w.text)) || next.start - w.end > 0.45 || cur.length >= 6) {
      phrases.push(cur);
      cur = [];
    }
  });
  const headTop = faces ? Math.min(...faces.samples.filter((s) => s.face).map((s) => s.face!.headTop)) : 0.3;
  const above = headTop > 0.2;
  const beats: unknown[] = [];
  const sfx: unknown[] = [];
  phrases.forEach((ph, i) => {
    const start = Math.max(0, ph[0]!.start - 0.08);
    const end = Math.min((phrases[i + 1]?.[0]?.start ?? ph.at(-1)!.end + 0.6) - 0.02, ph.at(-1)!.end + 1.2);
    const key = ph.find((w) => w.emph) ?? [...ph].sort((a, b) => bare(b.text).length - bare(a.text).length)[0]!;
    const ki = ph.indexOf(key);
    const before = ph.slice(0, ki).map((w) => bare(w.text)).join(" ");
    const after = ph.slice(ki + 1).map((w) => bare(w.text)).join(" ");
    const items: unknown[] = [];
    if (before) items.push({ text: before, role: "label", size: 0.042, color: "milk", at: ph[0]!.start, anim: "word" });
    items.push({ text: bare(key.text).toUpperCase(), role: "sans", size: 0.17, color: "pink", at: key.start, anim: "stagger" });
    if (after) items.push({ text: after, role: i % 2 ? "script" : "italic", size: 0.085, color: "milk", at: ph[ki + 1]!.start, anim: "script", dx: 0.06 });
    beats.push({ kind: "poster", id: `p${i + 1}`, start, end, bg: above ? "shade-top" : "shade-bottom", anchorY: above ? 0.17 : 0.64, behind: above, items, exit: "up" });
    sfx.push({ t: Math.max(0, key.start - 0.06), kind: i === phrases.length - 1 ? "impact" : "whoosh", gain: 0.6, reason: `постер «${bare(key.text)}»` });
  });
  const data = { sfxTheme: "cinematic", captionWindows: opt.captions ? [[0, 9999]] : [], camera: [], layouts: [], beats, sfx };
  const file = join(p.storyboard, existsSync(join(p.storyboard, "beats.json")) && !opt.force ? "beats.template.json" : "beats.json");
  writeFileSync(file, JSON.stringify(data, null, 1));
  out({ file, posters: beats.length, placement: above ? "над головой (за человеком)" : "нижняя треть" });
});
