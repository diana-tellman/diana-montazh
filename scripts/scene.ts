/**
 * npm run scene -- <id> <N>
 *
 * "3-кадрды өзгерт" helper: prints every storyboard element that lives in frame N
 * (with its exact path in storyboard.json) plus the frame's shot-list entry, so Claude edits
 * precisely that frame. After editing: `npm run storyboard -- <id>` (new version, approval revoked).
 * Meaning-level changes (window, scheme, comparison) go through storyboard/directions.json + `npm run plan`.
 */
import { loadStoryboard } from "../src/storyboard/store";
import { buildShotList } from "../src/storyboard/shotlist";
import { main, out, parseArgs } from "./_cli";

main(async () => {
  const { pos } = parseArgs();
  const id = pos[0] ?? "";
  const n = Number(pos[1]);
  const sb = loadStoryboard(id);
  const s = sb.scenes.find((x) => x.index === n);
  if (!s) throw new Error(`Нет кадра ${pos[1]}. В сториборде кадры 1–${sb.scenes.length}.`);
  const hit = (a: number, b: number) => a < s.end && b > s.start;
  const pick = <T extends { start: number; end: number }>(arr: T[], name: string) =>
    arr.map((x, i) => ({ path: `${name}[${i}]`, ...x })).filter((x) => hit(x.start, x.end));
  out({
    id,
    version: sb.version,
    frame: n,
    start: s.start,
    end: s.end,
    shot: buildShotList(sb).find((x) => x.index === n),
    captions: pick(sb.captions, "captions").map((c) => ({ path: c.path, start: c.start, end: c.end, y: c.y, scale: c.scale, text: c.lines.map((l) => l.map((w) => (w.emphasis ? `*${w.text}*` : w.text)).join(" ")).join(" / ") })),
    layouts: pick(sb.layouts, "layouts").map((l) => ({ path: l.path, start: l.start, end: l.end, kind: l.kind, shape: l.shape, card: l.card ? { variant: l.card.variant, items: l.card.items.map((x) => x.text) } : null })),
    behindText: pick(sb.behindText, "behindText").map((b) => ({ path: b.path, start: b.start, end: b.end, text: b.text })),
    callouts: pick(sb.callouts, "callouts"),
    icons: pick(sb.icons, "icons").map((x) => ({ path: x.path, start: x.start, name: x.name, word: x.word })),
    widgets: pick(sb.widgets ?? [], "widgets").map((x) => ({ path: x.path, start: x.start, kind: x.kind, text: x.text })),
    sfx: sb.sfx.map((f, i) => ({ path: `sfx[${i}]`, t: f.t, kind: f.kind })).filter((f) => f.t >= s.start && f.t < s.end),
    camera: sb.camera.map((k, i) => ({ path: `camera[${i}]`, ...k })).filter((k) => k.t >= s.start && k.t <= s.end),
    beats: (sb.beats ?? []).filter((b) => hit(b.start, b.end)),
    next: "Правка storyboard.json по path → npm run storyboard -- <id>. Смысловой приём целиком — storyboard/directions.json → npm run plan -- <id>.",
  });
});
