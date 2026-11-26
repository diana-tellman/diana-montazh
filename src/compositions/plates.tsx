import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_FAMILIES } from "../design/fontNames";
import { ICONS } from "../design/icons";
import { enterStyle, exitStyle, IN_DUR, OUT_DUR, progress } from "../motion/anim";
import type { Beat, Storyboard } from "../storyboard/schema";
import { palette } from "./beats";

type Plate = Extract<Beat, { kind: "plate" }>;
type Transition = Extract<Beat, { kind: "transition" }>;
const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Icon: React.FC<{ name: string; size: number; color: string; draw: number }> = ({ name, size, color, draw }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {(ICONS[name] ?? []).map((d, i) => <path key={i} d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />)}
  </svg>
);

/** Plates: glass, solid, outline, bracket, tag, lower third, number, CTA, quote — one design system. */
export const PlateBeat: React.FC<{ b: Plate; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const p = palette(sb);
  const W = sb.width;
  const px = b.size * W;
  const rp = progress(t, b.start, IN_DUR[b.anim]);
  const e = interpolate(t, [b.end - OUT_DUR, b.end], [0, 1], C);
  const en = enterStyle(b.anim, rp, px);
  const draw = progress(t, b.start + 0.1, 0.5);
  const sans: React.CSSProperties = { fontFamily: FONT_FAMILIES.intertight, fontWeight: 800, fontSize: px, letterSpacing: "-0.02em", lineHeight: 1.05, whiteSpace: "pre" };
  const label: React.CSSProperties = { fontFamily: FONT_FAMILIES.intertight, fontWeight: 700, fontSize: px * 0.42, letterSpacing: "0.18em", textTransform: "uppercase", whiteSpace: "pre" };
  let body: React.ReactNode;
  switch (b.variant) {
    case "glass":
    case "solid":
    case "outline": {
      const bg = b.variant === "glass" ? "rgba(25,25,25,0.45)" : b.variant === "solid" ? p.pink : "transparent";
      const fg = b.variant === "solid" ? p.graphite : p.milk;
      const border = b.variant === "solid" ? "none" : `${b.variant === "glass" ? 1.5 : 2.5}px solid rgba(247,245,242,${b.variant === "glass" ? 0.35 : 0.9})`;
      body = (
        <div style={{ display: "flex", alignItems: "center", gap: px * 0.4, padding: `${px * 0.42}px ${px * 0.7}px`, borderRadius: px * 0.55, background: bg, border, boxShadow: b.variant === "glass" ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 18px 50px rgba(0,0,0,0.3)" : "0 18px 50px rgba(0,0,0,0.25)" }}>
          {b.icon ? <Icon name={b.icon} size={px * 1.05} color={fg} draw={draw} /> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: px * 0.12 }}>
            <div style={{ ...sans, color: fg }}>{b.text}</div>
            {b.sub ? <div style={{ ...label, color: fg, opacity: 0.75 }}>{b.sub}</div> : null}
          </div>
        </div>
      );
      break;
    }
    case "bracket":
      body = (
        <div style={{ display: "flex", alignItems: "center", gap: px * 0.18, color: p.milk }}>
          <span style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 300, fontSize: px * 1.35, lineHeight: 1, transform: `translateX(${(1 - rp) * px * 0.6}px)` }}>[</span>
          <span style={{ ...sans, fontWeight: 600, letterSpacing: "-0.03em" }}>{b.text}</span>
          <span style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 300, fontSize: px * 1.35, lineHeight: 1, transform: `translateX(${-(1 - rp) * px * 0.6}px)` }}>]</span>
        </div>
      );
      break;
    case "tag":
      body = <div style={{ ...label, fontSize: px * 0.55, color: p.graphite, background: p.milk, padding: `${px * 0.22}px ${px * 0.5}px`, borderRadius: 999 }}>{b.text}</div>;
      break;
    case "lowerThird":
      body = (
        <div style={{ display: "flex", gap: px * 0.35, alignItems: "stretch" }}>
          <div style={{ width: Math.max(5, px * 0.09), background: sb.style.colors.accent, borderRadius: 3, transform: `scaleY(${draw})`, transformOrigin: "top" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: px * 0.14 }}>
            <div style={{ ...sans, color: p.milk }}>{b.text}</div>
            {b.sub ? <div style={{ fontFamily: FONT_FAMILIES.cormorant, fontStyle: "italic", fontWeight: 700, fontSize: px * 0.75, color: p.pink, whiteSpace: "pre" }}>{b.sub}</div> : null}
          </div>
        </div>
      );
      break;
    case "number":
      body = (
        <div style={{ display: "flex", flexDirection: "column", alignItems: b.align === "left" ? "flex-start" : b.align === "right" ? "flex-end" : "center" }}>
          <div style={{ ...sans, fontWeight: 900, fontSize: px * 2.6, letterSpacing: "-0.06em", lineHeight: 0.9, color: p.pink }}>{b.text}</div>
          {b.sub ? <div style={{ ...label, color: p.milk }}>{b.sub}</div> : null}
        </div>
      );
      break;
    case "cta": {
      const pulse = 1 + 0.025 * Math.sin((t - b.start) * 5) * Math.min(1, rp);
      body = (
        <div style={{ display: "flex", alignItems: "center", gap: px * 0.35, padding: `${px * 0.45}px ${px * 0.9}px`, borderRadius: 999, background: p.pink, color: p.graphite, transform: `scale(${pulse})`, boxShadow: "0 18px 50px rgba(0,0,0,0.3)" }}>
          {b.icon ? <Icon name={b.icon} size={px * 1.05} color={p.graphite} draw={draw} /> : null}
          <span style={{ ...sans, fontWeight: 800 }}>{b.text}</span>
        </div>
      );
      break;
    }
    case "quote":
      body = (
        <div style={{ display: "flex", alignItems: "flex-start", gap: px * 0.2, color: p.milk }}>
          <span style={{ fontFamily: FONT_FAMILIES.cormorant, fontWeight: 700, fontSize: px * 2.2, lineHeight: 0.8, color: p.pink }}>“</span>
          <span style={{ fontFamily: FONT_FAMILIES.cormorant, fontStyle: "italic", fontWeight: 700, fontSize: px * 1.1, lineHeight: 1.05, whiteSpace: "pre" }}>{b.text}</span>
        </div>
      );
      break;
  }
  const tx = b.align === "center" ? "-50%" : b.align === "right" ? "-100%" : "0";
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: b.x * W, top: b.y * sb.height, transform: `translate(${tx}, -50%)` }}>
        <div style={exitStyle(b.exit, e, px)}>
          <div style={{ overflow: en.masked ? "hidden" : "visible" }}>
            <div style={en.inner}>{body}</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Transitions drawn above everything; the composition underneath switches at the midpoint. */
export const TransitionBeat: React.FC<{ b: Transition; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (b.end - b.start) * fps;
  const k = frame / Math.max(1, dur);
  const W = sb.width;
  const H = sb.height;
  const p = palette(sb);
  switch (b.style) {
    case "flash": {
      const o = k < 0.5 ? interpolate(k, [0, 0.5], [0, 1], { ...C, easing: Easing.in(Easing.quad) }) : interpolate(k, [0.5, 1], [1, 0], { ...C, easing: Easing.out(Easing.quad) });
      return <AbsoluteFill style={{ backgroundColor: p.milk, opacity: o * 0.92 }} />;
    }
    case "whip": {
      const x = interpolate(k, [0, 1], [-1.2, 1.2], { ...C, easing: Easing.inOut(Easing.cubic) });
      const o = Math.sin(Math.PI * k);
      return (
        <AbsoluteFill style={{ opacity: o }}>
          <AbsoluteFill style={{ background: `repeating-linear-gradient(0deg, rgba(247,245,242,0.0) 0px, rgba(247,245,242,0.22) 3px, rgba(247,245,242,0) 9px)`, transform: `translateX(${x * W}px) scaleX(3)` }} />
          <AbsoluteFill style={{ background: `linear-gradient(90deg, transparent ${(x + 0.6) * 50 - 30}%, rgba(25,25,25,0.85) ${(x + 0.6) * 50}%, transparent ${(x + 0.6) * 50 + 30}%)` }} />
        </AbsoluteFill>
      );
    }
    case "zoom": {
      const o = Math.sin(Math.PI * k);
      return (
        <AbsoluteFill style={{ opacity: o }}>
          <AbsoluteFill style={{ background: "repeating-conic-gradient(from 0deg at 50% 40%, rgba(247,245,242,0.18) 0deg 1.2deg, transparent 1.2deg 6deg)", transform: `scale(${1 + k * 1.5})`, transformOrigin: "50% 40%" }} />
          <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, rgba(247,245,242,${0.9 * o}) 0%, transparent ${20 + 40 * k}%)` }} />
        </AbsoluteFill>
      );
    }
    case "shape": {
      const grow = interpolate(k, [0, 0.5], [0, 1], { ...C, easing: Easing.bezier(0.7, 0, 0.84, 0) });
      const shrink = interpolate(k, [0.5, 1], [1, 0], { ...C, easing: Easing.bezier(0.16, 1, 0.3, 1) });
      const s = k < 0.5 ? grow : shrink;
      const D = Math.hypot(W, H) * 1.15;
      return (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: D, height: D, borderRadius: D * 0.22, background: p.burgundy, transform: `scale(${s}) rotate(${(k < 0.5 ? 1 : -1) * (1 - s) * 25}deg)` }} />
        </AbsoluteFill>
      );
    }
    case "type": {
      const kk = Easing.bezier(0.65, 0, 0.35, 1)(Math.min(1, Math.max(0, k)));
      const pw = W * 1.7;
      const x = W - kk * (W + pw);
      return (
        <AbsoluteFill>
          <div style={{ position: "absolute", left: x, top: 0, width: pw, height: H, background: p.milk, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 60px rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 900, fontSize: W * 0.3, letterSpacing: "-0.05em", color: p.graphite, whiteSpace: "nowrap", transform: `translateX(${(0.5 - kk) * 18}%)` }}>{b.text ?? ""}</div>
          </div>
        </AbsoluteFill>
      );
    }
  }
};
