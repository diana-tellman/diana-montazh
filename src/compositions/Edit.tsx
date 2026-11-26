import { Audio, Video } from "@remotion/media";
import { useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { ensureFontsLoaded, FONT_FAMILIES } from "../design/fonts";
import { contrastRatio, resolveStyle, type StyleDef } from "../design/styles";
import { easeInOut } from "../layout/frame";
import { cardRect, personAt, secondaryBox } from "../layout/person";
import { iconForWord, ICONS } from "../design/icons";
import { captionBand, safeZone } from "../layout/safeZones";
import { cameraAt, layoutStateAt, LAYOUT_IN, LAYOUT_OUT, StoryboardSchema, type BehindText, type Callout, type Caption, type Card, type Icon, type Layout, type Storyboard, type Visual, type Widget } from "../storyboard/schema";

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
  const a2 = sb.style.colors.accent2 ?? a;
  const light = resolveStyle(sb.style.preset, sb.style.overrides).panel === "light";
  const base = light ? "#F4F1EE" : "#0D0B0C";
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at ${50 + 18 * Math.sin(t * 0.35)}% ${30 + 10 * Math.cos(t * 0.27)}%, ${light ? "#FFFFFF" : a} 0%, ${base} 62%)` }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute", width: 560 - i * 120, height: 560 - i * 120, borderRadius: "50%",
            left: `${20 + i * 25 + 8 * Math.sin(t * (0.4 + i * 0.13) + i)}%`, top: `${15 + i * 22 + 6 * Math.cos(t * (0.3 + i * 0.1) + i * 2)}%`,
            background: `radial-gradient(circle, ${i === 1 ? a2 : a}${light ? "22" : "40"} 0%, transparent 70%)`, transform: "translate(-50%,-50%)",
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
  const title: React.CSSProperties = { fontFamily: FONT_FAMILIES[st.titleFont], fontWeight: st.titleWeight, textTransform: st.titleUppercase ? "uppercase" : "none", letterSpacing: "-0.02em", lineHeight: 1.02, color: st.panel === "light" && l.kind === "explainer" ? "#141414" : "#FFFFFF", textShadow: st.panel === "light" && l.kind === "explainer" ? "none" : "0 6px 30px rgba(0,0,0,0.35)" };
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

  const tNow = l.start + frame / fps;
  const a2 = col.accent2 ?? col.accent;
  const light = st.panel === "light";
  const ink = light ? "#141414" : "#FFFFFF";

  if (card.variant === "headline") {
    const it = card.items[0];
    if (!it) return null;
    const p = appear(frame, fps, it.at, l.start);
    const lp = appear(frame, fps, l.start + 0.05, l.start);
    const sp = card.script ? interpolate(tNow, [it.at + 0.3, it.at + 0.9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
    const big = st.titleUppercase ? it.text.toUpperCase() : it.text;
    const px = fitPx(big, w * 0.94, W * 0.24, st.titleFont === "oswald" ? 0.5 : 0.7);
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: out, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {it.icon ? <div style={{ ...badge(W * 0.15, p), marginBottom: h * 0.05 }}><IconGlyph name={it.icon} size={W * 0.085} color={onAcc} draw={p} /></div> : null}
        {card.label ? <div style={{ fontFamily: FONT_FAMILIES[st.font], fontWeight: 600, fontSize: W * 0.05, color: ink, opacity: lp, transform: `translateY(${(1 - lp) * 20}px)`, textAlign: "center" }}>{card.label}</div> : null}
        <div style={{ width: w }}>
          <FitLine maxWidth={w * 0.96} frame={frame}>
            <div style={{ ...title, color: col.accent === "#141414" ? ink : col.accent, fontSize: px, textShadow: light ? "none" : title.textShadow, clipPath: `inset(${(1 - p) * 100}% 0 0 0)`, transform: `translateY(${(1 - p) * 40}px)` }}>{big}</div>
          </FitLine>
        </div>
        {card.script ? (
          <div style={{ width: w, marginTop: -px * 0.12, transform: "rotate(-3deg)" }}>
            <FitLine maxWidth={w * 0.92} frame={frame}>
              <div style={{ ...accentLine, color: a2, fontSize: W * 0.085, whiteSpace: "nowrap", clipPath: `inset(0 ${(1 - sp) * 100}% 0 0)` }}>{card.script}</div>
            </FitLine>
          </div>
        ) : null}
      </div>
    );
  }

  if (card.variant === "counter") {
    const it = card.items[0];
    const k = interpolate(tNow, [it?.at ?? l.start, (it?.at ?? l.start) + 1.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const v = Math.round((card.value ?? 0) * (1 - (1 - k) ** 3));
    const num = `${v.toLocaleString("ru-RU")}${card.suffix === "%" ? "%" : ""}`;
    const ring = 2 * Math.PI * W * 0.3;
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: out, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <svg width={W * 0.66} height={W * 0.66} style={{ position: "absolute", top: h / 2 - W * 0.33 - h * 0.06 }}>
          <circle cx={W * 0.33} cy={W * 0.33} r={W * 0.3} stroke={light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)"} strokeWidth={10} fill="none" />
          <circle cx={W * 0.33} cy={W * 0.33} r={W * 0.3} stroke={col.accent} strokeWidth={10} fill="none" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - k)} transform={`rotate(-90 ${W * 0.33} ${W * 0.33})`} />
          {Array.from({ length: 60 }, (_, i) => (
            <line key={i} x1={W * 0.33} y1={W * 0.015} x2={W * 0.33} y2={i % 5 ? W * 0.03 : W * 0.045} stroke={a2} strokeOpacity={i / 60 <= k ? 0.9 : 0.2} strokeWidth={3} transform={`rotate(${i * 6} ${W * 0.33} ${W * 0.33})`} />
          ))}
        </svg>
        {card.label ? <div style={{ fontFamily: FONT_FAMILIES[st.font], fontWeight: 600, fontSize: W * 0.042, color: ink, opacity: 0.85, zIndex: 1, textAlign: "center", maxWidth: W * 0.5 }}>{card.label}</div> : null}
        <div style={{ ...title, color: light ? col.accent : "#FFFFFF", fontSize: fitPx(num, W * 0.5, W * 0.2, 0.55), zIndex: 1 }}>{num}</div>
        {card.suffix && card.suffix !== "%" ? <div style={{ ...accentLine, color: a2, fontSize: W * 0.07, zIndex: 1, transform: "rotate(-3deg)" }}>{card.suffix}</div> : null}
      </div>
    );
  }

  if (card.variant === "flow") {
    // Nodes zig-zag down the card; curved connector draws from one node to the next as it is spoken (reference «Бұрын → direct»).
    const n = card.items.length;
    const d = W * 0.15;
    const pts = card.items.map((_, k) => ({ cx: k % 2 ? w * 0.72 : w * 0.28, cy: (h * (k + 0.5)) / n }));
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: out }}>
        {card.title ? <div style={{ position: "absolute", top: -W * 0.08, width: "100%", textAlign: "center" }}><span style={{ background: col.accent, color: col.onAccent, borderRadius: 999, padding: "8px 26px", fontFamily: FONT_FAMILIES[st.font], fontWeight: 800, fontSize: W * 0.036 }}>{card.title}</span></div> : null}
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {pts.slice(0, -1).map((p0, k) => {
            const p1 = pts[k + 1]!;
            const pl = interpolate(tNow, [card.items[k]!.at + 0.2, Math.max(card.items[k]!.at + 0.4, card.items[k + 1]!.at)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const dPath = `M ${p0.cx} ${p0.cy} C ${p0.cx} ${(p0.cy + p1.cy) / 2}, ${p1.cx} ${(p0.cy + p1.cy) / 2}, ${p1.cx} ${p1.cy}`;
            return <path key={k} d={dPath} stroke={col.accent} strokeWidth={7} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - pl} />;
          })}
        </svg>
        {card.items.map((it, k) => {
          const p = appear(frame, fps, it.at, l.start);
          const pt = pts[k]!;
          return (
            <div key={k} style={{ position: "absolute", left: pt.cx - W * 0.2, top: pt.cy - d / 2, width: W * 0.4, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, opacity: p, transform: `scale(${0.6 + 0.4 * p})` }}>
              <div style={{ width: d, height: d, borderRadius: W * 0.04, background: k === n - 1 ? col.accent : light ? "#141414" : "#1E1A1C", border: `2px solid ${k === n - 1 ? col.accent : "rgba(255,255,255,0.18)"}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 34px rgba(0,0,0,0.35)" }}>
                <IconGlyph name={it.icon} size={d * 0.5} color="#FFFFFF" draw={p} fallback={String(k + 1)} />
              </div>
              <div style={{ background: k === n - 1 ? col.accent : light ? "#FFFFFF" : "rgba(255,255,255,0.12)", color: k === n - 1 ? col.onAccent : ink, borderRadius: 999, padding: "6px 18px", fontFamily: FONT_FAMILIES[st.font], fontWeight: 700, fontSize: fitPx(it.text, W * 0.38, W * 0.036, 0.55), whiteSpace: "nowrap", boxShadow: light ? "0 6px 18px rgba(0,0,0,0.12)" : "none" }}>{it.text}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (card.variant === "orbit") {
    // Centre badge + rings; satellites fly onto the orbit as each item is named (reference orbit diagram).
    const cx = w / 2;
    const cy = h * 0.48;
    const R = Math.min(w, h) * 0.38;
    const n = card.items.length;
    const spin = frame / fps * 8;
    const cp = appear(frame, fps, l.start + 0.05, l.start);
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: out }}>
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
          {[1, 0.66].map((r, i) => <circle key={i} cx={cx} cy={cy} r={R * r * cp} stroke={col.accent} strokeOpacity={0.55} strokeWidth={3} fill="none" />)}
        </svg>
        <div style={{ position: "absolute", left: cx - W * 0.1, top: cy - W * 0.1, ...badge(W * 0.2, cp) }}>
          <IconGlyph name={iconForWord(card.title) ?? "star"} size={W * 0.1} color={onAcc} draw={cp} />
        </div>
        {card.title ? <div style={{ position: "absolute", left: 0, width: w, top: cy + W * 0.12, textAlign: "center", ...title, color: ink, textShadow: "none", fontSize: fitPx(card.title, w * 0.4, W * 0.045) }}>{card.title}</div> : null}
        {card.items.map((it, k) => {
          const p = appear(frame, fps, it.at, l.start);
          const ang = ((k / n) * 360 - 90 + spin) * (Math.PI / 180);
          const rr = R * (1.5 - 0.5 * p);
          const px0 = cx + Math.cos(ang) * rr;
          const py0 = cy + Math.sin(ang) * rr;
          return (
            <div key={k} style={{ position: "absolute", left: px0 - W * 0.13, top: py0 - W * 0.05, width: W * 0.26, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, opacity: p }}>
              <div style={{ width: W * 0.09, height: W * 0.09, borderRadius: "50%", background: col.accent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 0 6px ${col.accent}33` }}>
                <IconGlyph name={it.icon} size={W * 0.05} color={col.onAccent} draw={p} fallback={String(k + 1)} />
              </div>
              <div style={{ background: light ? "#141414" : "rgba(255,255,255,0.14)", color: "#FFFFFF", borderRadius: 999, padding: "4px 14px", fontFamily: FONT_FAMILIES[st.font], fontWeight: 700, fontSize: fitPx(it.text, W * 0.25, W * 0.03, 0.55), whiteSpace: "nowrap" }}>{it.text}</div>
            </div>
          );
        })}
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
  let { p } = layoutStateAt([l], Math.min(t, l.end - 0.0001));
  if (l.kind === "explainer") {
    // Back-to-back explainer scenes: no reveal between them — the cards themselves animate.
    const prevJoin = sb.layouts.some((o) => o.kind === "explainer" && o.id !== l.id && Math.abs(o.end - l.start) < 0.02);
    const nextJoin = sb.layouts.some((o) => o.kind === "explainer" && o.id !== l.id && Math.abs(o.start - l.end) < 0.02);
    if ((prevJoin && t - l.start < LAYOUT_IN) || (nextJoin && l.end - t < LAYOUT_OUT)) p = 1;
    return (
      <AbsoluteFill style={{ clipPath: `circle(${Math.max(0.01, p) * 101}% at 50% 42%)` }}>
        <Graphic sb={sb} />
        <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
        <AbsoluteFill style={{ background: st.panel === "light" ? "rgba(255,255,255,0.0)" : "rgba(10,10,12,0.35)" }} />
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
  const st = resolveStyle(sb.style.preset, sb.style.overrides);
  const col = sb.style.colors;
  const v = sb.visuals.find((x) => t >= x.start && t < x.end) ?? sb.visuals[0]!;
  const dur = (b.end - b.start) * fps;
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
  const exit = interpolate(frame, [dur - 8, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = b.size * sb.width;
  const idx = String(frame + 1).padStart(5, "0");
  const bigColor = sb.style.preset === "bordeaux" ? col.accent : col.text === "#141414" ? col.accent : "#FFFFFF";
  // Count-up numbers (0 → value over 0.9 s, eased).
  const k = interpolate(frame, [0, 0.9 * fps], [0, 1], { extrapolateRight: "clamp" });
  const shown = b.count ? `${b.count.prefix}${Math.round(b.count.from + (b.count.to - b.count.from) * (1 - (1 - k) ** 3)).toLocaleString("ru-RU")}${b.count.suffix}` : b.text;
  const pIn = (at: number | undefined) => (at === undefined ? 1 : interpolate(t, [at, at + 0.35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const lp = pIn(b.labelAt ?? b.start);
  const sp = pIn(b.scriptAt);
  const mask = Math.min(1, enter * 1.15);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: b.y * sb.height - px * 0.55, textAlign: "center" }}>
        {b.label ? (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: px * 0.02, fontFamily: FONT_FAMILIES[st.font], fontWeight: 600, fontSize: sb.width * 0.044, color: "#FFFFFF", textShadow: "0 1px 3px rgba(0,0,0,0.8), 0 2px 14px rgba(0,0,0,0.6)", opacity: lp, transform: `translateY(${(1 - lp) * 16}px)` }}>{b.label}</div>
        ) : null}
        <div
          style={{
            fontFamily: FONT_FAMILIES[st.titleFont], fontWeight: st.titleWeight >= 800 ? 900 : st.titleWeight, fontSize: px, lineHeight: 1, letterSpacing: st.titleFont === "oswald" ? "0" : "-0.02em",
            color: bigColor, textShadow: "0 10px 40px rgba(0,0,0,0.35)",
            clipPath: `inset(${(1 - mask) * 100}% 0 0 0)`, transform: `translateY(${(1 - enter) * 40}px) scale(${0.9 + 0.1 * enter})`,
          }}
        >
          <FitLine maxWidth={sb.width * 0.9} frame={frame}><span>{shown}</span></FitLine>
        </div>
      </div>
      {useMattes && b.matteDir && !b.front && v.kind === "video" ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Framed v={v} sb={sb} t={t}>
            <Img src={staticFile(`${b.matteDir}/${idx}.webp`)} style={{ width: v.srcW, height: v.srcH }} />
          </Framed>
        </AbsoluteFill>
      ) : null}
      {b.script && b.scriptY !== undefined ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: b.scriptY * sb.height, textAlign: "center", fontFamily: FONT_FAMILIES[st.accentFont], fontStyle: st.accentItalic ? "italic" : "normal", fontWeight: st.accentItalic ? 700 : 400, fontSize: sb.width * 0.075, color: col.accent2 ?? "#FFFFFF", textShadow: "0 3px 18px rgba(0,0,0,0.55)", clipPath: `inset(0 ${(1 - sp) * 100}% 0 0)`, transform: "rotate(-3deg)", whiteSpace: "nowrap" }}>
          <FitLine maxWidth={sb.width * 0.86} frame={frame}><span>{b.script}</span></FitLine>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------- glass widgets ----------------

const WidgetView: React.FC<{ w: Widget; sb: Storyboard }> = ({ w, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const st = resolveStyle(sb.style.preset, sb.style.overrides);
  const col = sb.style.colors;
  const W = sb.width;
  const dur = (w.end - w.start) * fps;
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 170 } });
  const out = interpolate(frame, [dur - 7, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ww = w.w * W;
  const banner = w.kind === "notify" || w.kind === "search" || w.kind === "comment";
  const glass: React.CSSProperties = { background: "rgba(22,18,20,0.62)", border: "1.5px solid rgba(255,255,255,0.24)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 18px 44px rgba(0,0,0,0.38)", color: "#FFFFFF", fontFamily: FONT_FAMILIES[st.font] };
  const k = interpolate(frame, [4, 4 + 0.9 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ease = 1 - (1 - k) ** 3;
  const acc = col.accent;
  const acc2 = col.accent2 ?? col.accent;
  const enterTf = w.kind === "notify" ? `translateY(${(1 - pop) * -140}px)` : `scale(${0.7 + 0.3 * pop})`;
  const typed = (text: string) => text.slice(0, Math.max(0, Math.floor(interpolate(frame, [6, 6 + Math.max(10, text.length * 2)], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))));
  let body: React.ReactNode = null;
  if (w.kind === "notify") {
    body = (
      <div style={{ display: "flex", gap: W * 0.025, alignItems: "center", padding: W * 0.025 }}>
        <div style={{ width: W * 0.075, height: W * 0.075, borderRadius: W * 0.02, background: `linear-gradient(135deg, ${acc2}, ${acc})`, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <IconGlyph name="bell" size={W * 0.045} color="#FFFFFF" draw={1} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: W * 0.03 }}>Instagram <span style={{ opacity: 0.55, fontWeight: 500 }}>· қазір</span></div>
          <div style={{ fontSize: W * 0.03, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.text}</div>
        </div>
      </div>
    );
  } else if (w.kind === "search" || w.kind === "comment") {
    const caret = Math.floor(frame / 8) % 2 ? "|" : " ";
    body = (
      <div style={{ display: "flex", alignItems: "center", gap: W * 0.02, padding: `${W * 0.022}px ${W * 0.03}px` }}>
        <IconGlyph name={w.kind === "search" ? "eye" : "chat"} size={W * 0.045} color={acc2} draw={1} />
        <div style={{ flex: 1, fontSize: W * 0.036, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden" }}>{typed(w.text)}{caret}</div>
        <div style={{ width: W * 0.06, height: W * 0.06, borderRadius: "50%", background: acc, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: W * 0.035 }}>→</div>
      </div>
    );
  } else if (w.kind === "counter") {
    const n = Math.round((w.value ?? 0) * ease);
    body = (
      <div style={{ padding: W * 0.025, textAlign: "center" }}>
        <div style={{ fontSize: W * 0.024, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.12em" }}>{w.text}</div>
        <div style={{ fontFamily: FONT_FAMILIES[st.titleFont], fontWeight: 700, fontSize: W * 0.075, lineHeight: 1.05 }}>{n.toLocaleString("ru-RU")}</div>
        <div style={{ color: acc2, fontWeight: 800, fontSize: W * 0.03 }}>▲ +{Math.max(1, Math.round((w.value ?? 0) * 0.12 * ease)).toLocaleString("ru-RU")}</div>
      </div>
    );
  } else if (w.kind === "ring") {
    const v = Math.min(100, w.value ?? 0) * ease;
    const R = ww * 0.3;
    const C = 2 * Math.PI * R;
    body = (
      <div style={{ padding: W * 0.02, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <svg width={R * 2 + 16} height={R * 2 + 16}>
          <circle cx={R + 8} cy={R + 8} r={R} stroke="rgba(255,255,255,0.15)" strokeWidth={12} fill="none" />
          <circle cx={R + 8} cy={R + 8} r={R} stroke={acc2} strokeWidth={12} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} transform={`rotate(-90 ${R + 8} ${R + 8})`} />
          <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fill="#FFFFFF" fontFamily={FONT_FAMILIES[st.titleFont]} fontWeight={700} fontSize={R * 0.6}>{Math.round(v)}%</text>
        </svg>
        <div style={{ fontSize: W * 0.026, opacity: 0.8, marginTop: 6, textAlign: "center" }}>{w.text}</div>
      </div>
    );
  } else if (w.kind === "toggle") {
    const on = interpolate(frame, [10, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    body = (
      <div style={{ display: "flex", alignItems: "center", gap: W * 0.02, padding: W * 0.025 }}>
        <div style={{ flex: 1, fontSize: W * 0.028, fontWeight: 700, lineHeight: 1.15 }}>{w.text}</div>
        <div style={{ width: W * 0.11, height: W * 0.062, borderRadius: W * 0.04, background: on > 0.5 ? "#34C759" : "rgba(255,255,255,0.25)", position: "relative", flex: "none" }}>
          <div style={{ position: "absolute", top: W * 0.006, left: W * 0.006 + on * W * 0.048, width: W * 0.05, height: W * 0.05, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }} />
        </div>
      </div>
    );
  } else if (w.kind === "timer") {
    const total = w.value ?? 60;
    const left = Math.max(0, total - Math.floor(frame / fps));
    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    body = (
      <div style={{ padding: W * 0.025, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: ww * 0.62, height: ww * 0.62, borderRadius: "50%", border: `6px solid ${acc2}`, fontFamily: FONT_FAMILIES.intertight, fontWeight: 800, fontSize: W * 0.055 }}>{`${mm}:${ss}`}</div>
        <div style={{ fontSize: W * 0.026, opacity: 0.8, marginTop: 6 }}>{w.text}</div>
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: w.x * W - ww / 2, top: w.y * sb.height, width: ww, transform: `translateY(-50%) ${enterTf}`, opacity: out * Math.min(1, pop * 1.4), borderRadius: banner ? W * 0.045 : W * 0.04, ...glass }}>
      {body}
    </div>
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
              const marker = w.emphasis && !accentAsText && !(active && st.active === "pill") && sb.style.preset !== "lime" && sb.style.preset !== "editorial" && !(col.accent2 && st.active === "underline");
              if (w.emphasis && col.accent2 && st.active === "underline") color = col.accent2;
              const under = active && st.active === "underline" ? interpolate(wf, [0, 4], [0, 1], { extrapolateRight: "clamp" }) : 0;
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
                    background: pill ? col.accent : marker ? `linear-gradient(transparent 58%, ${col.accent} 58%, ${col.accent} 92%, transparent 92%)` : under > 0 ? `linear-gradient(90deg, ${col.accent2 ?? col.accent} ${under * 100}%, transparent ${under * 100}%) no-repeat 0 96% / 100% ${Math.max(4, px * 0.08)}px` : "transparent",
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
      {(sb.widgets ?? []).map((w) => (
        <Sequence key={w.id} from={f(w.start)} durationInFrames={Math.max(1, f(w.end) - f(w.start))}>
          <WidgetView w={w} sb={sb} />
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
