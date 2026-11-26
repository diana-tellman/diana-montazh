import { Audio, Video } from "@remotion/media";
import { useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { ensureFontsLoaded, FONT_FAMILIES } from "../design/fonts";
import { contrastRatio, resolveStyle, type StyleDef } from "../design/styles";
import { easeInOut } from "../layout/frame";
import { cardRect, personAt, secondaryBox } from "../layout/person";
import { ICONS } from "../design/icons";
import { captionBand, safeZone } from "../layout/safeZones";
import { cameraAt, layoutStateAt, LAYOUT_IN, LAYOUT_OUT, StoryboardSchema, type BehindText, type Callout, type Caption, type Card, type Icon, type Layout, type Storyboard, type Visual } from "../storyboard/schema";

ensureFontsLoaded();

const GuideRect = z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() });
export const editSchema = z.object({
  storyboard: StoryboardSchema,
  /** Storyboard preview only: safe zone, face boxes and a scene label. Never in the final render. */
  guides: z.object({ faceBoxes: z.array(GuideRect), label: z.string() }).nullable(),
  /** Matte frames are only present for the final render (and selected preview frames). */
  useMattes: z.boolean(),
});
export type EditProps = z.infer<typeof editSchema>;

export const calculateEditMetadata: CalculateMetadataFunction<EditProps> = ({ props }) => ({
  width: props.storyboard.width,
  height: props.storyboard.height,
  fps: props.storyboard.fps,
  durationInFrames: Math.max(1, Math.round(props.storyboard.durationSec * props.storyboard.fps)),
});


// ---------------- visuals + camera ----------------

const Graphic: React.FC<{ sb: Storyboard }> = ({ sb }) => {
  const frame = useCurrentFrame();
  const t = frame / sb.fps;
  const a = sb.style.colors.accent;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at ${50 + 18 * Math.sin(t * 0.35)}% ${30 + 10 * Math.cos(t * 0.27)}%, ${a} 0%, #141414 62%)` }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute", width: 520 - i * 120, height: 520 - i * 120, borderRadius: "50%",
            left: `${20 + i * 25 + 8 * Math.sin(t * (0.4 + i * 0.13) + i)}%`, top: `${15 + i * 22 + 6 * Math.cos(t * (0.3 + i * 0.1) + i * 2)}%`,
            background: i === 1 ? "rgba(247,245,242,0.06)" : `${a}33`, transform: "translate(-50%,-50%)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Source-aligned layer: everything inside moves exactly like the video (used for the cut-out too). */
const Framed: React.FC<{ v: Visual; sb: Storyboard; t: number; children: React.ReactNode }> = ({ v, sb, t, children }) => {
  const cam = cameraAt(sb.camera, t, easeInOut);
  const win = personAt(sb.layouts, t, v.srcW, v.srcH, sb.width, sb.height, v.framing, cam).window;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: v.srcW, height: v.srcH, transformOrigin: "0 0", transform: `translate(${win.offX}px, ${win.offY}px) scale(${win.scale})` }}>
      {children}
    </div>
  );
};

/** The other part of a layout: photo (slow push), clip or brand graphic. */
const Secondary: React.FC<{ l: Layout; sb: Storyboard }> = ({ l, sb }) => {
  const frame = useCurrentFrame();
  const b = secondaryBox(l.kind, sb.width, sb.height);
  const push = 1 + 0.06 * (frame / Math.max(1, (l.end - l.start) * sb.fps));
  const media = l.secondaryKind !== "graphic" && l.secondary;
  return (
    <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, overflow: "hidden", backgroundColor: "#141414" }}>
      {!media ? (
        <Graphic sb={sb} />
      ) : l.secondaryKind === "photo" ? (
        <Img src={staticFile(l.secondary!)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${push})` }} />
      ) : (
        <Video src={staticFile(l.secondary!)} muted objectFit="cover" style={{ width: "100%", height: "100%" }} />
      )}
      {media && l.card ? <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)" }} /> : null}
    </div>
  );
};

const VisualLayer: React.FC<{ v: Visual; sb: Storyboard }> = ({ v, sb }) => {
  const frame = useCurrentFrame(); // local to the Sequence
  const t = v.start + frame / sb.fps;
  if (v.kind === "graphic") return <Graphic sb={sb} />;
  const cam = cameraAt(sb.camera, t, easeInOut);
  const pa = personAt(sb.layouts, t, v.srcW, v.srcH, sb.width, sb.height, v.framing, cam);
  const { box } = pa;
  const W = sb.width;
  const H = sb.height;
  const framed = pa.kind !== "full" && pa.kind !== "explainer";
  const clip = framed ? `inset(${box.y}px ${W - box.x - box.w}px ${H - box.y - box.h}px ${box.x}px round ${pa.radius}px)` : "none";
  const f = (s: number) => Math.round(s * sb.fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "#141414", overflow: "hidden" }}>
      {sb.layouts.filter((l) => l.end > v.start && l.start < v.end && l.kind !== "full" && l.kind !== "explainer").map((l) => (
        <Sequence key={l.id} from={f(l.start - v.start)} durationInFrames={Math.max(1, f(l.end) - f(l.start))}>
          <Secondary l={l} sb={sb} />
        </Sequence>
      ))}
      {v.fill && !framed ? <Video src={staticFile(v.fill)} muted objectFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} trimBefore={Math.round(v.srcStart * sb.fps)} /> : null}
      <AbsoluteFill style={{ clipPath: clip }}>
        <Framed v={v} sb={sb} t={t}>
          {v.kind === "video" && v.src ? (
            <Video src={staticFile(v.src)} muted trimBefore={Math.round(v.srcStart * sb.fps)} style={{ width: v.srcW, height: v.srcH }} />
          ) : v.src ? (
            <Img src={staticFile(v.src)} style={{ width: v.srcW, height: v.srcH }} />
          ) : null}
        </Framed>
      </AbsoluteFill>
      {framed && (pa.kind === "circle" || pa.kind === "pip") ? (
        <div style={{ position: "absolute", left: box.x - 5, top: box.y - 5, width: box.w + 10, height: box.h + 10, borderRadius: pa.radius + 5, border: `${Math.max(1, 8 * pa.p)}px solid #FFFFFF`, boxShadow: `0 0 0 ${3 * pa.p}px ${sb.style.colors.accent}, 0 24px 60px rgba(0,0,0,${0.45 * pa.p})` }} />
      ) : null}
      {framed && (pa.kind === "split" || pa.kind === "compare") ? <div style={{ position: "absolute", left: 0, top: box.y - 4, width: W * pa.p, height: 8, background: sb.style.colors.accent }} /> : null}
    </AbsoluteFill>
  );
};

// ---------------- meaning cards: example / compare / steps; explainer screen ----------------

const appear = (frame: number, fps: number, at: number, start: number) => {
  const f0 = Math.round((at - start) * fps);
  return frame < f0 ? 0 : spring({ frame: frame - f0, fps, config: { damping: 15, stiffness: 160 } });
};
const fitPx = (text: string, maxW: number, maxPx: number, k = 0.6) => Math.max(24, Math.min(maxPx, maxW / Math.max(1, text.length * k)));

const IconGlyph: React.FC<{ name: string | null; size: number; color: string; draw: number; fallback?: string }> = ({ name, size, color, draw, fallback }) => {
  const paths = name ? ICONS[name] ?? [] : [];
  if (!paths.length) return <span style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 900, fontSize: size * 0.7, color, lineHeight: 1 }}>{fallback ?? ""}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((p, i) => (
        <path key={i} d={p} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
      ))}
    </svg>
  );
};

const CardView: React.FC<{ card: Card; l: Layout; sb: Storyboard; st: StyleDef }> = ({ card, l, sb, st }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = cardRect(l.kind)!;
  const W = sb.width;
  const x = r.x0 * W;
  const y = r.y0 * sb.height;
  const w = (r.x1 - r.x0) * W;
  const h = (r.y1 - r.y0) * sb.height;
  const col = sb.style.colors;
  const dur = (l.end - l.start) * fps;
  const out = interpolate(frame, [dur - LAYOUT_OUT * fps, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const title: React.CSSProperties = { fontFamily: FONT_FAMILIES[st.titleFont], fontWeight: st.titleWeight, textTransform: st.titleUppercase ? "uppercase" : "none", letterSpacing: "-0.02em", lineHeight: 1.02, color: "#FFFFFF", textShadow: "0 6px 30px rgba(0,0,0,0.35)" };
  const accentLine: React.CSSProperties = { fontFamily: FONT_FAMILIES[st.accentFont], fontStyle: st.accentItalic ? "italic" : "normal", fontWeight: st.accentItalic ? 700 : 600, color: col.accent === "#141414" ? "#FFFFFF" : col.accent };
  const glass: React.CSSProperties = { background: "rgba(16,16,20,0.58)", border: "1.5px solid rgba(255,255,255,0.22)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 20px 50px rgba(0,0,0,0.35)" };
  const badge = (d: number, p: number): React.CSSProperties => ({ width: d, height: d, borderRadius: "50%", background: col.accent, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${p}) rotate(${(1 - p) * -25}deg)`, boxShadow: "0 12px 30px rgba(0,0,0,0.35)", flex: "none" });
  const onAcc = col.onAccent;

  if (card.variant === "example") {
    const it = card.items[0];
    if (!it) return null;
    const p = appear(frame, fps, it.at, l.start);
    const label = st.titleUppercase ? it.text.toUpperCase() : it.text;
    const px = fitPx(label, w * 0.84, W * 0.11, st.titleUppercase ? 0.76 : 0.62);
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 44, ...glass, opacity: out, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: h * 0.06 }}>
        {card.title ? <div style={{ ...accentLine, fontSize: W * 0.05, opacity: p }}>{card.title}</div> : null}
        <div style={badge(W * 0.12, p)}>
          <IconGlyph name={it.icon} size={W * 0.07} color={onAcc} draw={Math.min(1, p * 1.2)} fallback="→" />
        </div>
        <div style={{ ...title, fontSize: px, textAlign: "center", padding: "0 4%", clipPath: `inset(0 0 ${(1 - p) * 100}% 0)`, transform: `translateY(${(1 - p) * 30}px)` }}>{label}</div>
      </div>
    );
  }

  if (card.variant === "compare") {
    const [a, b] = card.items;
    if (!a || !b) return null;
    const pa = appear(frame, fps, a.at, l.start);
    const pb = appear(frame, fps, b.at, l.start);
    const colW = w * 0.44;
    const panel = (it: Card["items"][number], p: number, side: -1 | 1, hi: boolean) => {
      const label = st.titleUppercase ? it.text.toUpperCase() : it.text;
      return (
        <div style={{ width: colW, height: h * 0.82, borderRadius: 40, ...glass, ...(hi ? { border: `3px solid ${col.accent}` } : {}), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: h * 0.06, opacity: p, transform: `translateX(${side * (1 - p) * 120}px)` }}>
          <div style={badge(W * 0.13, p)}>
            <IconGlyph name={it.icon} size={W * 0.075} color={onAcc} draw={p} fallback={side < 0 ? "A" : "B"} />
          </div>
          <div style={{ ...title, fontSize: fitPx(label, colW * 0.8, W * 0.07, st.titleUppercase ? 0.78 : 0.64), textAlign: "center", padding: "0 6%" }}>{label}</div>
        </div>
      );
    };
    const vs = appear(frame, fps, Math.max(a.at, b.at - 0.15), l.start);
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: out, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {panel(a, pa, -1, false)}
        {panel(b, pb, 1, true)}
        <div style={{ position: "absolute", left: w / 2 - W * 0.065, top: h * 0.5 - W * 0.065, width: W * 0.13, height: W * 0.13, borderRadius: "50%", background: "#FFFFFF", color: "#141414", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_FAMILIES.intertight, fontWeight: 900, fontSize: W * 0.045, transform: `scale(${vs})`, boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>VS</div>
        {card.title ? <div style={{ position: "absolute", top: -W * 0.075, width: "100%", textAlign: "center", ...accentLine, fontSize: W * 0.05 }}>{card.title}</div> : null}
      </div>
    );
  }

  // steps: numbered nodes with icons, a connector line drawn from step to step as they are spoken.
  const n = card.items.length;
  const top = card.title ? h * 0.13 : 0;
  const rowH = (h - top) / Math.max(n, 2);
  const d = Math.min(W * 0.13, rowH * 0.7);
  const lastOn = card.items.reduce((acc, it, k) => (l.start + frame / fps >= it.at ? k : acc), -1);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: out }}>
      {card.title ? <div style={{ ...title, fontSize: fitPx(card.title, w * 0.9, W * 0.07), textAlign: "center", width: "100%" }}>{card.title}</div> : null}
      {card.items.slice(0, -1).map((it, k) => {
        const nx = card.items[k + 1]!;
        const pl = interpolate(l.start + frame / fps, [it.at + 0.15, Math.max(it.at + 0.3, nx.at)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return <div key={`ln${k}`} style={{ position: "absolute", left: w * 0.04 + d / 2 - 3, top: top + rowH * k + rowH / 2 + d / 2, width: 6, height: (rowH - d) * pl, borderRadius: 3, background: col.accent, opacity: 0.85 }} />;
      })}
      {card.items.map((it, k) => {
        const p = appear(frame, fps, it.at, l.start);
        const label = it.text;
        const active = k === lastOn;
        return (
          <div key={k} style={{ position: "absolute", left: w * 0.04, top: top + rowH * k + rowH / 2 - d / 2, height: d, width: w * 0.92, display: "flex", alignItems: "center", gap: W * 0.04, opacity: p * (active || lastOn < 0 ? 1 : 0.62), transform: `translateX(${(1 - p) * -80}px) scale(${active ? 1 : 0.95})`, transformOrigin: "left center" }}>
            <div style={badge(d, p)}>
              <IconGlyph name={it.icon} size={d * 0.56} color={onAcc} draw={p} fallback={String(k + 1)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ ...accentLine, fontSize: d * 0.3, opacity: 0.95 }}>{`${k + 1}`.padStart(2, "0")}</div>
              <div style={{ ...title, fontSize: fitPx(st.titleUppercase ? label.toUpperCase() : label, w * 0.88 - d - W * 0.04, d * 0.5, st.titleUppercase ? 0.76 : 0.62), textTransform: st.titleUppercase ? "uppercase" : "none" }}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Full-screen explainer: the speaker leaves (circular reveal), the voice continues over an animated scheme. */
const LayoutOverlay: React.FC<{ l: Layout; sb: Storyboard; st: StyleDef }> = ({ l, sb, st }) => {
  const frame = useCurrentFrame();
  const t = l.start + frame / sb.fps;
  const { p } = layoutStateAt([l], Math.min(t, l.end - 0.0001));
  if (l.kind === "explainer") {
    return (
      <AbsoluteFill style={{ clipPath: `circle(${Math.max(0.01, p) * 101}% at 50% 42%)` }}>
        <Graphic sb={sb} />
        <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
        <AbsoluteFill style={{ background: "rgba(10,10,12,0.35)" }} />
        {l.card ? <CardView card={l.card} l={l} sb={sb} st={st} /> : null}
      </AbsoluteFill>
    );
  }
  return l.card ? <AbsoluteFill style={{ opacity: Math.min(1, p * 1.4) }}><CardView card={l.card} l={l} sb={sb} st={st} /></AbsoluteFill> : null;
};

/** Badge with a line icon that draws itself, pops in and floats. */
const IconBadge: React.FC<{ ic: Icon; sb: Storyboard }> = ({ ic, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (ic.end - ic.start) * fps;
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const draw = interpolate(frame, [3, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const out = interpolate(frame, [dur - 7, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const d = ic.size * sb.width;
  const paths = ICONS[ic.name] ?? [];
  const floatY = Math.sin(frame / 9) * d * 0.03;
  return (
    <div style={{ position: "absolute", left: ic.x * sb.width - d / 2, top: ic.y * sb.height - d / 2 + floatY, width: d, height: d, borderRadius: "50%", background: sb.style.colors.accent, boxShadow: "0 14px 40px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${pop * out}) rotate(${(1 - pop) * -20}deg)`, opacity: out }}>
      <svg width={d * 0.58} height={d * 0.58} viewBox="0 0 24 24" fill="none" stroke={sb.style.colors.onAccent} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        {paths.map((p, i) => (
          <path key={i} d={p} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        ))}
      </svg>
    </div>
  );
};

// ---------------- text behind the subject ----------------

const BehindTextLayer: React.FC<{ b: BehindText; sb: Storyboard; useMattes: boolean }> = ({ b, sb, useMattes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const v = sb.visuals.find((x) => t >= x.start && t < x.end) ?? sb.visuals[0]!;
  const dur = (b.end - b.start) * fps;
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
  const exit = interpolate(frame, [dur - 8, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = b.size * sb.width;
  const idx = String(frame + 1).padStart(5, "0");
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: b.y * sb.height - px * 0.55, textAlign: "center",
          fontFamily: FONT_FAMILIES[resolveStyle(sb.style.preset, sb.style.overrides).titleFont], fontWeight: 900, fontSize: px, lineHeight: 1, letterSpacing: "-0.02em",
          color: sb.style.colors.text === "#141414" ? sb.style.colors.accent : "#FFFFFF",
          textShadow: "0 10px 40px rgba(0,0,0,0.35)",
          opacity: exit, transform: `translateY(${(1 - enter) * 40}px) scale(${0.9 + 0.1 * enter})`,
        }}
      >
        {b.text}
      </div>
      {useMattes && b.matteDir && v.kind === "video" ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Framed v={v} sb={sb} t={t}>
            <Img src={staticFile(`${b.matteDir}/${idx}.webp`)} style={{ width: v.srcW, height: v.srcH }} />
          </Framed>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------- captions ----------------

/** Shrinks a line that would overflow the safe width (measured in the browser, every frame). */
const FitLine: React.FC<{ maxWidth: number; children: React.ReactNode; frame: number }> = ({ maxWidth, children, frame }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.scrollWidth;
    const next = w > maxWidth ? maxWidth / w : 1;
    if (Math.abs(next - k) > 0.001) setK(next);
  }, [frame, maxWidth, k]);
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div ref={ref} style={{ display: "inline-flex", flexWrap: "nowrap", whiteSpace: "nowrap", transform: `scale(${k})`, transformOrigin: "center top" }}>
        {children}
      </div>
    </div>
  );
};

const CaptionBlock: React.FC<{ c: Caption; sb: Storyboard; st: StyleDef }> = ({ c, sb, st }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = c.start + frame / fps;
  const col = sb.style.colors;
  const px = st.size * Math.min(sb.width, sb.height) * c.scale;
  const band = captionBand(safeZone(sb.platform), c.y + (c.lines.length * px * st.lineHeight + px * 0.5) / sb.height);
  const dur = (c.end - c.start) * fps;
  const inP = spring({ frame, fps, config: { damping: 15, stiffness: 170 } });
  const outP = interpolate(frame, [dur - 5, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const words = c.lines.flat();
  // Active word = the last word that has started (stays active through short pauses).
  const activeIdx = words.reduce((acc, w, i) => (t >= w.start ? i : acc), -1);

  const blockAnim =
    st.enter === "pop" ? { transform: `scale(${0.86 + 0.14 * inP})`, opacity: outP * Math.min(1, inP * 1.5) }
    : st.enter === "rise" ? { transform: `translateY(${(1 - inP) * 26}px)`, opacity: outP * inP }
    : st.enter === "slide" ? { transform: `translateX(${(1 - inP) * -60}px) rotate(-2deg)`, opacity: outP }
    : { opacity: outP * interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" }) };

  const textDeco: React.CSSProperties =
    // No outline: a tight dark shadow + a soft halo keeps white text readable on any background.
    st.backdrop === "shadow" ? { textShadow: "0 1px 2px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.6), 0 0 22px rgba(0,0,0,0.4)" }
    : {};
  const container: React.CSSProperties =
    st.backdrop === "glass" ? { background: "rgba(16,18,24,0.55)", border: "1.5px solid rgba(255,255,255,0.28)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 40px rgba(0,0,0,0.35)", borderRadius: px * 0.45, padding: `${px * 0.22}px ${px * 0.42}px` }
    : sb.style.preset === "lime" ? { background: col.accent, borderRadius: px * 0.18, padding: `${px * 0.16}px ${px * 0.32}px`, boxShadow: "0 10px 0 rgba(0,0,0,0.85)" }
    : {};

  // Coloured words are only reliable on a dark glass plate; over video use a marker bar.
  const accentAsText = st.backdrop === "glass" && /^#[0-9a-f]{6}$/i.test(col.accent) && contrastRatio(col.accent, "#000000") >= 4.5;
  let wi = -1;
  return (
    <div style={{ position: "absolute", left: band.x0 * sb.width, width: (band.x1 - band.x0) * sb.width, top: c.y * sb.height, display: "flex", justifyContent: "center" }}>
      <div style={{ ...container, ...blockAnim, transformOrigin: "center center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {c.lines.map((line, li) => (
          <FitLine key={li} maxWidth={(band.x1 - band.x0) * sb.width - px * 0.8} frame={frame}>
            {line.map((w, k) => {
              wi++;
              const i = wi;
              const spoken = i <= activeIdx;
              const active = i === activeIdx;
              const wf = Math.max(0, Math.round((t - w.start) * fps));
              const pop = spring({ frame: wf, fps, config: { damping: 13, stiffness: 220 } });
              const hidden = st.upcoming === "hidden" && !spoken;
              let color = st.upcoming === "dim" && !spoken ? col.upcoming : col.text;
              const marker = w.emphasis && !accentAsText && !(active && st.active === "pill") && sb.style.preset !== "lime" && sb.style.preset !== "editorial";
              if (w.emphasis && sb.style.preset === "editorial") color = col.accent;
              if (w.emphasis && !(active && st.active === "pill") && accentAsText) color = sb.style.preset === "lime" ? col.text : col.accent;
              if (active && st.active === "color") color = col.accent;
              const pill = active && st.active === "pill";
              const scale = (w.emphasis ? st.emphasisScale : 1) * (active && st.active === "scale" ? 1.1 : 1) * (st.upcoming === "hidden" ? 0.7 + 0.3 * pop : 1);
              return (
                <span
                  key={k}
                  style={{
                    fontFamily: FONT_FAMILIES[w.emphasis && sb.style.preset === "editorial" ? st.accentFont : st.font], fontStyle: w.emphasis && sb.style.preset === "editorial" && st.accentItalic ? "italic" : "normal", fontWeight: w.emphasis && sb.style.preset === "editorial" ? 700 : st.weight, fontSize: w.emphasis && sb.style.preset === "editorial" ? px * 1.18 : px, lineHeight: st.lineHeight,
                    letterSpacing: `${st.letterSpacing}em`, color: pill ? col.onAccent : color,
                    margin: `0 ${px * 0.12}px`, padding: pill ? `${px * 0.04}px ${px * 0.2}px` : `${px * 0.04}px 0`,
                    borderRadius: px * 0.22,
                    background: pill ? col.accent : marker ? `linear-gradient(transparent 58%, ${col.accent} 58%, ${col.accent} 92%, transparent 92%)` : "transparent",
                    opacity: hidden ? 0 : 1, display: "inline-block", transform: `scale(${scale}) translateY(${st.enter === "rise" && !hidden ? (1 - pop) * 10 : 0}px)`,
                    ...(pill ? {} : textDeco),
                  }}
                >
                  {w.text}
                </span>
              );
            })}
          </FitLine>
        ))}
      </div>
    </div>
  );
};

const CalloutBlock: React.FC<{ c: Callout; sb: Storyboard }> = ({ c, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 14 } });
  const dur = (c.end - c.start) * fps;
  const out = interpolate(frame, [dur - 6, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = 0.042 * sb.width;
  const style: React.CSSProperties =
    c.kind === "glass" ? { background: "rgba(16,18,24,0.55)", border: "1.5px solid rgba(255,255,255,0.3)", color: "#fff" }
    : c.kind === "cta" ? { background: sb.style.colors.accent, color: sb.style.colors.onAccent, boxShadow: `0 0 ${20 + 10 * Math.sin(frame / 5)}px ${sb.style.colors.accent}` }
    : { background: "#fff", color: "#141414" };
  return (
    <div style={{ position: "absolute", top: c.y * sb.height, width: "100%", display: "flex", justifyContent: "center", opacity: out }}>
      <div style={{ ...style, fontFamily: FONT_FAMILIES[resolveStyle(sb.style.preset, sb.style.overrides).titleFont], fontWeight: 800, fontSize: px, whiteSpace: "nowrap", padding: `${px * 0.45}px ${px * 0.9}px`, borderRadius: px, transform: `scale(${0.8 + 0.2 * p})` }}>{c.text}</div>
    </div>
  );
};

const ProgressBar: React.FC<{ sb: Storyboard }> = ({ sb }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const safe = safeZone(sb.platform);
  const w = (safe.x1 - safe.x0) * sb.width;
  return (
    <div style={{ position: "absolute", left: safe.x0 * sb.width, top: safe.y0 * sb.height - 26, width: w, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.18)" }}>
      <div style={{ width: (w * frame) / Math.max(1, durationInFrames - 1), height: 8, borderRadius: 4, background: sb.style.colors.accent }} />
    </div>
  );
};

const Guides: React.FC<{ sb: Storyboard; g: NonNullable<EditProps["guides"]> }> = ({ sb, g }) => {
  const s = safeZone(sb.platform);
  const W = sb.width;
  const H = sb.height;
  const shade = "rgba(255,40,40,0.22)";
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: s.y0 * H, background: shade }} />
      <div style={{ position: "absolute", left: 0, top: s.y1 * H, width: W, height: (1 - s.y1) * H, background: shade }} />
      <div style={{ position: "absolute", left: s.x1 * W, top: s.y0 * H, width: (1 - s.x1) * W, height: (s.y1 - s.y0) * H, background: shade }} />
      <div style={{ position: "absolute", left: 0, top: s.y0 * H, width: s.x0 * W, height: (s.y1 - s.y0) * H, background: shade }} />
      <div style={{ position: "absolute", left: s.x0 * W, top: s.y0 * H, width: (s.x1 - s.x0) * W, height: (s.y1 - s.y0) * H, border: "4px dashed #FFD60A" }} />
      {g.faceBoxes.map((b, i) => (
        <div key={i} style={{ position: "absolute", left: b.x0 * W, top: b.y0 * H, width: (b.x1 - b.x0) * W, height: (b.y1 - b.y0) * H, border: "5px solid #2EE66B", borderRadius: 12 }} />
      ))}
      <div style={{ position: "absolute", left: 24, top: 24, padding: "10px 22px", borderRadius: 16, background: "rgba(0,0,0,0.75)", color: "#fff", fontFamily: FONT_FAMILIES.inter, fontWeight: 800, fontSize: 44 }}>{g.label}</div>
    </AbsoluteFill>
  );
};

// ---------------- audio ----------------

/** Music envelope: ducked under speech (0.25 s ramps), fade-in 0.6 s, fade-out 1.2 s. */
export function musicGain(sb: Storyboard, t: number): number {
  const m = sb.music;
  if (!m) return 0;
  let d = Infinity;
  for (const [a, b] of m.speech) {
    if (t >= a && t <= b) {
      d = 0;
      break;
    }
    d = Math.min(d, t < a ? a - t : t - b);
  }
  const k = Math.min(1, Math.max(0, (d - 0.05) / 0.25));
  const fade = Math.min(1, t / 0.6, Math.max(0, (sb.durationSec - t) / 1.2));
  return (m.duck + (m.gain - m.duck) * k) * fade;
}

// ---------------- composition ----------------

export const Edit: React.FC<EditProps> = ({ storyboard: sb, guides, useMattes }) => {
  const st = resolveStyle(sb.style.preset, sb.style.overrides);
  const f = (s: number) => Math.round(s * sb.fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "#141414" }}>
      {sb.visuals.map((v) => (
        <Sequence key={v.id} from={f(v.start)} durationInFrames={Math.max(1, f(v.end) - f(v.start))} premountFor={15}>
          <VisualLayer v={v} sb={sb} />
        </Sequence>
      ))}
      {sb.layouts.filter((l) => l.kind !== "full" && (l.card || l.kind === "explainer")).map((l) => (
        <Sequence key={`ov-${l.id}`} from={f(l.start)} durationInFrames={Math.max(1, f(l.end) - f(l.start))}>
          <LayoutOverlay l={l} sb={sb} st={st} />
        </Sequence>
      ))}
      {sb.behindText.map((b) => (
        <Sequence key={b.id} from={f(b.start)} durationInFrames={Math.max(1, f(b.end) - f(b.start))}>
          <BehindTextLayer b={b} sb={sb} useMattes={useMattes} />
        </Sequence>
      ))}
      {sb.icons.map((ic) => (
        <Sequence key={ic.id} from={f(ic.start)} durationInFrames={Math.max(1, f(ic.end) - f(ic.start))}>
          <IconBadge ic={ic} sb={sb} />
        </Sequence>
      ))}
      {sb.captions.map((c) => (
        <Sequence key={c.id} from={f(c.start)} durationInFrames={Math.max(1, f(c.end) - f(c.start))}>
          <CaptionBlock c={c} sb={sb} st={st} />
        </Sequence>
      ))}
      {sb.callouts.map((c) => (
        <Sequence key={c.id} from={f(c.start)} durationInFrames={Math.max(1, f(c.end) - f(c.start))}>
          <CalloutBlock c={c} sb={sb} />
        </Sequence>
      ))}
      {sb.progressBar ? <ProgressBar sb={sb} /> : null}
      <Audio src={staticFile(sb.voice.src)} volume={sb.voice.gain} />
      {sb.music ? <Audio src={staticFile(sb.music.src)} loop loopVolumeCurveBehavior="extend" volume={(fr) => musicGain(sb, fr / sb.fps)} /> : null}
      {sb.sfx.map((s, i) => (
        <Sequence key={`sfx${i}`} from={f(s.t)} durationInFrames={f(1.2)}>
          <Audio src={staticFile(`work/sfx/${s.kind}.wav`)} volume={s.gain} />
        </Sequence>
      ))}
      {guides ? <Guides sb={sb} g={guides} /> : null}
    </AbsoluteFill>
  );
};
