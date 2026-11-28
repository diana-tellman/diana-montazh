import type { Storyboard } from "./schema";

/**
 * Editable shot list ("раскадровка кестесі") built from the storyboard — the text the user reads on the phone:
 * every frame numbered, start–end, what is on screen, what is said, when text appears,
 * what changes inside the frame (with the second) and how it passes to the next frame.
 * Same data as the render, so the table never disagrees with the video.
 */
export type ShotEvent = { t: number; what: string };
export type Shot = {
  index: number;
  start: number;
  end: number;
  screen: string;
  spoken: string;
  texts: ShotEvent[];
  changes: ShotEvent[];
  transition: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

const LAYOUT_KK: Record<string, string> = {
  full: "спикер толық кадрда",
  circle: "спикер дөңгелек ішінде, артында фон/фото",
  split: "экран екіге бөлінген: жоғарыда фото/видео, төменде спикер",
  pip: "спикер жоғарғы терезеде, астында мысал карточкасы",
  compare: "жоғарыда салыстыру А | Б, төменде спикер",
  explainer: "толық экранды түсіндірме анимация (дауыс жалғасады)",
};
const VARIANT_KK: Record<string, string> = {
  example: "мысал", compare: "салыстыру", steps: "қадамдар", flow: "сызба (түйіндер + сызықтар)", orbit: "орбита (ортада + айналасы)", counter: "санауыш", headline: "үлкен тақырып",
};

export function buildShotList(sb: Storyboard): Shot[] {
  const words = sb.captions.flatMap((c) => c.lines.flat());
  const visualLabel = (t: number) => {
    const v = sb.visuals.find((x) => t >= x.start && t < x.end) ?? sb.visuals.at(-1);
    if (!v) return "";
    if (v.kind === "video") return "видео";
    if (v.kind === "photo") return `фото ${sb.visuals.indexOf(v) + 1}, баяу жақындау`;
    return "графикалық фон";
  };
  return sb.scenes.map((s, i) => {
    const s0 = s.start;
    const s1 = s.end;
    const inside = (t: number) => t >= s0 - 0.001 && t < s1 - 0.001;
    const lay = sb.layouts.find((l) => l.start <= s0 + 0.05 && l.end > s0 + 0.05);
    const card = lay?.card;
    let screen = lay ? LAYOUT_KK[lay.kind] ?? lay.kind : sb.mode === "expert-video" ? LAYOUT_KK.full! : visualLabel(s0 + 0.05);
    if (lay && (lay.kind === "split" || lay.kind === "circle" || lay.kind === "pip")) screen += lay.secondary ? ` (материал: ${lay.secondary.split("/").pop()})` : "";
    if (card) screen += `; карточка — ${VARIANT_KK[card.variant] ?? card.variant}${card.items.length ? `: ${card.items.map((x) => x.text).join(" · ")}` : ""}`;
    if (sb.mode !== "expert-video" && !lay) screen = visualLabel(s0 + 0.05);

    const spoken = words.filter((w) => inside(w.start)).map((w) => w.text).join(" ");

    const texts: ShotEvent[] = [];
    for (const c of sb.captions.filter((c) => inside(c.start))) {
      texts.push({ t: c.start, what: `субтитр «${c.lines.map((l) => l.map((w) => w.text).join(" ")).join(" ")}»${c.lines.flat().some((w) => w.emphasis) ? " (акцент сөзі бар)" : ""}` });
    }
    for (const b of sb.behindText.filter((b) => inside(b.start))) texts.push({ t: b.start, what: `үлкен сөз «${b.text}»${b.matteDir ? " бастың артында" : ""}${b.label ? `, үстінде «${b.label}»` : ""}${b.script ? `, астында «${b.script}»` : ""}` });
    for (const c of sb.callouts.filter((c) => inside(c.start))) texts.push({ t: c.start, what: `${c.kind === "cta" ? "батырма" : "плашка"} «${c.text}»` });
    for (const it of card?.items ?? []) if (inside(it.at)) texts.push({ t: it.at, what: `карточкада «${it.text}» шығады` });
    texts.sort((a, b) => a.t - b.t);

    const changes: ShotEvent[] = [];
    for (const l of sb.layouts) {
      if (l.start > s0 + 0.05 && inside(l.start)) changes.push({ t: l.start, what: `→ ${LAYOUT_KK[l.kind] ?? l.kind}` });
      if (l.end > s0 + 0.05 && inside(l.end) && l.end < sb.durationSec - 0.05) changes.push({ t: l.end, what: "→ спикер толық кадрға оралады" });
    }
    for (const k of sb.camera.filter((k) => k.move === "ease" && inside(k.t - k.dur) && k.t - k.dur > s0 + 0.05)) changes.push({ t: k.t - k.dur, what: `камера баяу ${k.zoom > 1.01 ? "жақындайды" : "қалпына келеді"} (${r1(k.dur)} с)` });
    for (const x of sb.icons.filter((x) => inside(x.start))) changes.push({ t: x.start, what: `иконка «${x.name}» («${x.word}» сөзінде)` });
    for (const w of (sb.widgets ?? []).filter((w) => inside(w.start))) changes.push({ t: w.start, what: `виджет ${w.kind}${w.text ? ` «${w.text}»` : ""}` });
    for (const f of sb.sfx.filter((f) => inside(f.t))) changes.push({ t: f.t, what: `дыбыс ${f.kind}` });
    changes.sort((a, b) => a.t - b.t);

    let transition = "соңы — соңғы кадр";
    if (i < sb.scenes.length - 1) {
      const layIn = sb.layouts.find((l) => Math.abs(l.start - s1) < 0.06);
      const layOut = sb.layouts.find((l) => Math.abs(l.end - s1) < 0.06);
      const cut = sb.camera.find((k) => k.move === "cut" && Math.abs(k.t - s1) < 0.06);
      const whoosh = sb.sfx.find((f) => (f.kind === "whoosh" || f.kind === "swipe") && Math.abs(f.t - s1) < 0.4);
      const nextVisual = sb.visuals.find((v) => Math.abs(v.start - s1) < 0.06);
      transition = layIn
        ? `${layIn.kind === "explainer" ? "дөңгелек ашылу арқылы схемаға" : "спикер терезеге/бөлікке жылжиды"} (0.35 с)`
        : layOut
          ? "спикер толық кадрға жылжып оралады (0.3 с)"
          : nextVisual
            ? "келесі фотоға ауысу"
            : cut
              ? "монтаж склейкасы (зум ауысады)"
              : "үздіксіз жалғасады";
      if (whoosh) transition += ` + дыбыс ${whoosh.kind}`;
    }
    return { index: s.index, start: s0, end: s1, screen, spoken, texts, changes, transition };
  });
}

/** Markdown for the chat / file: one block per frame (fits a phone screen better than a wide table). */
export function shotListMarkdown(sb: Storyboard): string {
  const shots = buildShotList(sb);
  const ev = (e: ShotEvent) => `${fmtTime(e.t)} ${e.what}`;
  const head = `# Раскадровка v${sb.version}\n${sb.format} · ${sb.durationSec.toFixed(1)} с · ${shots.length} кадр · стиль ${sb.style.source}\n\nӨзгерту үшін жазыңыз: «3-кадрды өзгерт: …». Бекіту үшін: «Мақұлдаймын».\n`;
  const body = shots
    .map(
      (s) =>
        `## ${s.index}-кадр · ${fmtTime(s.start)}–${fmtTime(s.end)}\n` +
        `- **Экранда:** ${s.screen || "—"}\n` +
        `- **Айтылады:** ${s.spoken || "— (үнсіз)"}\n` +
        `- **Мәтін шығады:** ${s.texts.length ? s.texts.map(ev).join("; ") : "—"}\n` +
        `- **Кадр ішінде:** ${s.changes.length ? s.changes.map(ev).join("; ") : "өзгеріс жоқ"}\n` +
        `- **Келесіге өту:** ${s.transition}\n`,
    )
    .join("\n");
  return `${head}\n${body}`;
}
