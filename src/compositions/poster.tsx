import { measureText } from "@remotion/layout-utils";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_FAMILIES } from "../design/fontNames";
import { EASE_MOVE, enterStyle, exitStyle, IN_DUR, OUT_DUR, progress, unitStyle } from "../motion/anim";
import type { Beat, Storyboard } from "../storyboard/schema";
import { Cutout, MonoVideo, palette, TextureBg } from "./beats";

type Poster = Extract<Beat, { kind: "poster" }>;
type Item = Poster["items"][number];

/** Typographic roles of the design system (all verified for Kazakh letters). */
export const ROLES: Record<Item["role"], { family: string; weight: number; style: "normal" | "italic"; lh: number; ls: number; upper: boolean }> = {
  sans: { family: FONT_FAMILIES.intertight, weight: 900, style: "normal", lh: 0.86, ls: -0.045, upper: false },
  serif: { family: FONT_FAMILIES.cormorant, weight: 600, style: "normal", lh: 1.0, ls: 0, upper: false },
  italic: { family: FONT_FAMILIES.cormorant, weight: 700, style: "italic", lh: 0.95, ls: -0.01, upper: false },
  script: { family: FONT_FAMILIES.badscript, weight: 400, style: "normal", lh: 1.15, ls: 0, upper: false },
  label: { family: FONT_FAMILIES.intertight, weight: 700, style: "normal", lh: 1.2, ls: 0.18, upper: true },
};

export const colorOf = (sb: Storyboard, c: Item["color"]) => {
  const p = palette(sb);
  return { milk: p.milk, pink: p.pink, burgundy: p.burgundy, graphite: p.graphite, accent: sb.style.colors.accent, text: sb.style.colors.text }[c];
};

export type Placed = { it: Item; px: number; w: number; h: number; x: number; y: number; anchor: "center" | "left" | "right" };

const measure = (it: Item, px: number) => {
  const r = ROLES[it.role];
  const text = r.upper ? it.text.toUpperCase() : it.text;
  const ls = it.tracking ?? r.ls;
  try {
    return measureText({ text, fontFamily: r.family, fontSize: px, fontWeight: String(r.weight), letterSpacing: `${ls}em`, validateFontIsLoaded: false }).width;
  } catch {
    return text.length * px * 0.55;
  }
};

/**
 * Stack engine: lays out items without an explicit `y` as one composition.
 * - every line is fitted into maxWidth (never overflows the safe width);
 * - leading is derived from the role's line height, so spacing is identical in every poster;
 * - an italic/script line after a sans line overlaps it (calligraphic accent crossing the headline);
 * - labels keep air around them.
 */
export function layoutPoster(b: Poster, W: number, H: number): Placed[] {
  const out: Placed[] = [];
  const stack: Placed[] = [];
  for (const it of b.items) {
    const r = ROLES[it.role];
    let px = it.size * W;
    let w = measure(it, px);
    const maxW = b.maxWidth * W;
    if (w > maxW) {
      px *= maxW / w;
      w = maxW;
    }
    const h = px * r.lh;
    const anchor = b.align;
    const baseX = anchor === "center" ? 0.5 * W : anchor === "left" ? (0.5 - b.maxWidth / 2) * W : (0.5 + b.maxWidth / 2) * W;
    const p: Placed = { it, px, w, h, x: (it.x !== undefined ? it.x * W : baseX) + it.dx * W, y: 0, anchor };
    if (it.y !== undefined) {
      p.y = it.y * H;
      out.push(p);
    } else stack.push(p);
  }
  // Vertical rhythm.
  const accent = (x: Item) => x.role === "italic" || x.role === "script";
  let cursor = 0;
  const tops: number[] = [];
  stack.forEach((p, i) => {
    if (i > 0) {
      const prev = stack[i - 1]!;
      let gap = 0.1 * Math.min(prev.px, p.px);
      // Accent crosses the bold line just enough to feel connected, never hiding its letters.
      if (accent(p.it) && prev.it.role === "sans") gap = (p.it.role === "script" ? -0.24 : -0.16) * p.px;
      else if (p.it.role === "sans" && accent(prev.it)) gap = -0.16 * prev.px;
      else if (p.it.role === "label" || prev.it.role === "label") gap = 0.45 * Math.min(prev.px, p.px) + 6;
      else if (p.it.role === "sans" && prev.it.role === "sans") gap = 0.02 * p.px;
      cursor += gap;
    }
    tops.push(cursor);
    cursor += p.h;
  });
  const top = b.anchorY * H - cursor / 2;
  stack.forEach((p, i) => (p.y = top + tops[i]! + p.h / 2));
  return [...stack, ...out];
}

const PosterLine: React.FC<{ p: Placed; b: Poster; sb: Storyboard; t: number }> = ({ p, b, sb, t }) => {
  const { it, px } = p;
  const r = ROLES[it.role];
  const H = sb.height;
  const text = r.upper ? it.text.toUpperCase() : it.text;
  const color = colorOf(sb, it.color);
  const outAt = Math.min(b.end, it.until ?? b.end) - OUT_DUR;
  const e = interpolate(t, [outAt, outAt + OUT_DUR], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rp = progress(t, it.at, IN_DUR[it.anim]);
  const mv = it.move ? progress(t, it.move.at, 0.5, EASE_MOVE) : 0;
  const dy = it.move ? it.move.dy * H * mv : 0;
  const sc = it.move ? 1 + (it.move.scale - 1) * mv : 1;
  const base: React.CSSProperties = {
    fontFamily: r.family, fontWeight: r.weight, fontStyle: r.style, fontSize: px, lineHeight: r.lh, letterSpacing: `${it.tracking ?? r.ls}em`,
    color, whiteSpace: "pre",
    textShadow: it.role === "sans" || it.role === "label" ? "0 6px 30px rgba(0,0,0,0.25)" : "0 0 24px rgba(247,245,242,0.18), 0 4px 20px rgba(0,0,0,0.3)",
  };
  const perUnit = it.anim === "stagger" || it.anim === "word" || it.anim === "typewriter";
  let inner: React.ReactNode = text;
  if (perUnit) {
    if (it.anim === "word") {
      const words = text.split(" ");
      inner = words.map((w, i) => (
        <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: px * 0.08 }}>
          <span style={unitStyle("word", t, it.wordTimes?.[i] ?? it.at + i * 0.14, px)}>{w + (i < words.length - 1 ? " " : "")}</span>
        </span>
      ));
    } else {
      const step = it.anim === "typewriter" ? 0.04 : 0.028;
      inner = [...text].map((ch, i) => <span key={i} style={unitStyle(it.anim, t, it.at + i * step, px)}>{ch}</span>);
    }
  }
  const en = perUnit ? { masked: it.anim === "stagger", inner: {}, outer: {} } : enterStyle(it.anim, rp, px);
  const ul = it.underline ? progress(t, it.at + IN_DUR[it.anim] * 0.6, 0.45) : 0;
  const tx = p.anchor === "center" ? "-50%" : p.anchor === "right" ? "-100%" : "0";
  return (
    <div style={{ position: "absolute", left: p.x, top: p.y + dy, transform: `translate(${tx}, -50%) rotate(${it.rotate}deg) scale(${sc})`, transformOrigin: "center" }}>
      <div style={exitStyle(b.exit, e, px)}>
        <div style={{ overflow: en.masked ? "hidden" : "visible", padding: en.masked ? `${px * 0.04}px ${px * 0.06}px ${px * 0.08}px` : 0, margin: en.masked ? `-${px * 0.04}px -${px * 0.06}px -${px * 0.08}px` : 0 }}>
          <div style={{ ...base, ...en.inner }}>{inner}</div>
        </div>
        {it.underline ? <div style={{ height: Math.max(5, px * 0.05), width: `${ul * 100}%`, background: sb.style.colors.accent, borderRadius: 4, marginTop: px * 0.04 }} /> : null}
      </div>
    </div>
  );
};

export const PosterBeat: React.FC<{ b: Poster; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const placed = layoutPoster(b, sb.width, sb.height);
  const bgO = Math.min(progress(t, b.start, 0.3), 1 - progress(t, b.end - 0.25, 0.25));
  const drift = b.drift ? 1 + 0.025 * interpolate(t, [b.start, b.end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const lines = (front: boolean) =>
    placed
      .filter((p) => (b.behind ? !!p.it.front === front : !front))
      // Calligraphic accents are drawn over the bold lines they cross.
      .sort((x, y) => Number(x.it.role === "italic" || x.it.role === "script") - Number(y.it.role === "italic" || y.it.role === "script"))
      .map((p, i) => <PosterLine key={`${front}${i}`} p={p} b={b} sb={sb} t={t} />);
  return (
    <AbsoluteFill>
      {b.bg === "mono" && b.monoSrc ? <AbsoluteFill style={{ opacity: bgO }}><MonoVideo sb={sb} t={t} src={b.monoSrc} startSec={b.start} /></AbsoluteFill> : null}
      {b.bg === "texture" ? <AbsoluteFill style={{ opacity: bgO }}><TextureBg sb={sb} /></AbsoluteFill> : null}
      {b.bg === "blur-dim" ? <AbsoluteFill style={{ opacity: bgO, backgroundColor: "rgba(25,25,25,0.55)" }} /> : null}
      {b.bg === "shade-top" ? <AbsoluteFill style={{ opacity: bgO, background: "linear-gradient(180deg, rgba(25,25,25,0.72) 0%, rgba(25,25,25,0.35) 28%, transparent 45%)" }} /> : null}
      {b.bg === "shade-bottom" ? <AbsoluteFill style={{ opacity: bgO, background: "linear-gradient(0deg, rgba(25,25,25,0.82) 0%, rgba(25,25,25,0.55) 35%, transparent 58%)" }} /> : null}
      <AbsoluteFill style={{ transform: `scale(${drift})`, transformOrigin: `50% ${b.anchorY * 100}%` }}>{lines(false)}</AbsoluteFill>
      {b.behind ? <Cutout sb={sb} t={t} dir={b.matteDir} start={b.matteStart} /> : null}
      {b.behind ? <AbsoluteFill style={{ transform: `scale(${drift})`, transformOrigin: `50% ${b.anchorY * 100}%` }}>{lines(true)}</AbsoluteFill> : null}
    </AbsoluteFill>
  );
};
