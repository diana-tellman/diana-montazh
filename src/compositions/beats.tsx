import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ICONS } from "../design/icons";
import { FONT_FAMILIES } from "../design/fontNames";
import { easeInOut } from "../layout/frame";
import { personWindow } from "../layout/person";
import { cameraAt, layoutAt, type Beat, type Storyboard, type Visual } from "../storyboard/schema";

/**
 * Motion-design beats. One meaningful device per speech block; every movement uses the same
 * easing family (expo-out in, quad-in out) and timing (in 180–350 ms, out 150–250 ms).
 */
export const EASE_IN = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_OUT = Easing.bezier(0.5, 0, 0.75, 0);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Brand palette for authored beats (falls back to the storyboard colours). */
export const palette = (sb: Storyboard) => ({
  bg: "#191919",
  fg: sb.style.colors.text,
  accent: sb.style.colors.accent,
  milk: "#F7F5F2",
  pink: "#F2D5E4",
  burgundy: "#8D263E",
  graphite: "#191919",
});

const visualAt = (sb: Storyboard, t: number): Visual => sb.visuals.find((x) => t >= x.start && t < x.end) ?? sb.visuals[0]!;

/** Layer aligned with the person's video at time t (same transform as the video itself). */
export const PersonAligned: React.FC<{ sb: Storyboard; t: number; children: (v: Visual) => React.ReactNode }> = ({ sb, t, children }) => {
  const v = visualAt(sb, t);
  const win = personWindow(layoutAt(sb.layouts, t), v.srcW, v.srcH, sb.width, sb.height, v.framing, cameraAt(sb.camera, t, easeInOut));
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: v.srcW, height: v.srcH, transformOrigin: "0 0", transform: `translate(${win.offX}px, ${win.offY}px) scale(${win.scale})` }}>
      {children(v)}
    </div>
  );
};

const matteSrc = (dir: string, start: number, t: number, fps: number, prefix = "") =>
  staticFile(`${dir}/${prefix}${String(Math.max(1, Math.round((t - start) * fps) + 1)).padStart(5, "0")}.webp`);

/** Person cut-out for time t (needs a generated matte). */
export const Cutout: React.FC<{ sb: Storyboard; t: number; dir: string | null; start: number; prefix?: string; style?: React.CSSProperties }> = ({ sb, t, dir, start, prefix, style }) =>
  dir ? (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <PersonAligned sb={sb} t={t}>{(v) => <Img src={matteSrc(dir, start, t, sb.fps, prefix)} style={{ width: v.srcW, height: v.srcH }} />}</PersonAligned>
    </AbsoluteFill>
  ) : null;

/** Brand background: deep graphite, fine grid, slow burgundy light. */
export const BrandBg: React.FC<{ sb: Storyboard }> = ({ sb }) => {
  const frame = useCurrentFrame();
  const p = palette(sb);
  const g = "rgba(245,245,243,0.045)";
  return (
    <AbsoluteFill style={{ backgroundColor: p.bg }}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${g} 2px, transparent 2px), linear-gradient(90deg, ${g} 2px, transparent 2px)`, backgroundSize: "90px 90px", backgroundPosition: `${(frame * 0.4) % 90}px 0` }} />
      <AbsoluteFill style={{ background: `radial-gradient(70% 45% at ${50 + 10 * Math.sin(frame / 60)}% 18%, ${p.accent}66 0%, transparent 70%)` }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.35) 100%)" }} />
    </AbsoluteFill>
  );
};

/** Monochrome editorial texture: deep graphite, fine vertical ribs, soft central light. */
export const TextureBg: React.FC<{ sb: Storyboard }> = ({ sb }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#262626" }}>
      <AbsoluteFill style={{ background: `radial-gradient(80% 55% at ${50 + 6 * Math.sin(frame / 70)}% 38%, #5a5a5a 0%, #303030 45%, #191919 100%)` }} />
      <AbsoluteFill style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 2px, transparent 2px, transparent 9px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, transparent 30%, transparent 65%, rgba(0,0,0,0.45) 100%)" }} />
    </AbsoluteFill>
  );
};

/** Black-and-white version of the person's video (pre-rendered by ffmpeg), aligned with the camera. */
export const MonoVideo: React.FC<{ sb: Storyboard; t: number; src: string; startSec: number; dim?: number }> = ({ sb, t, src, startSec, dim = 0.35 }) => (
  <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#191919" }}>
    <PersonAligned sb={sb} t={t}>{(v) => <Video src={staticFile(src)} muted trimBefore={Math.round((v.srcStart + startSec) * sb.fps)} style={{ width: v.srcW, height: v.srcH }} />}</PersonAligned>
    <AbsoluteFill style={{ backgroundColor: `rgba(25,25,25,${dim})` }} />
  </AbsoluteFill>
);

// ---------------- cutout: background replacement, compare, white outline ----------------

const CutoutBeat: React.FC<{ b: Extract<Beat, { kind: "cutout" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const W = sb.width;
  const H = sb.height;
  const dur = b.end - b.start;
  const inP = b.wipeIn === "none" ? 1 : interpolate(frame, [0, 0.35 * fps], [0, 1], { ...clamp, easing: EASE_IN });
  const outP = b.wipeOut === "none" ? 1 : interpolate(frame, [(dur - 0.3) * fps, dur * fps], [1, 0], { ...clamp, easing: EASE_OUT });
  const bgClip =
    b.wipeIn === "circle" && inP < 1 ? `circle(${inP * 120}% at 50% 40%)`
    : inP < 1 ? `inset(${(1 - inP) * 100}% 0 0 0)`
    : b.wipeOut === "circle" && outP < 1 ? `circle(${outP * 120}% at 50% 40%)`
    : outP < 1 ? `inset(0 0 ${(1 - outP) * 100}% 0)` : "none";

  // Before/after compare: original video left of a divider that slides in from the right.
  let divider: number | null = null;
  if (b.compare && t >= b.compare[0] && t < b.compare[1]) {
    const lt = t - b.compare[0];
    const rt = b.compare[1] - t;
    const k = Math.min(interpolate(lt, [0, 0.45], [0, 1], { ...clamp, easing: EASE_IN }), interpolate(rt, [0, 0.3], [0, 1], { ...clamp, easing: EASE_IN }));
    divider = W - k * W * 0.5;
  }
  // White outline: drawn top → bottom, then fades.
  let outline = 0;
  let outlineOpacity = 0;
  if (b.outline && t >= b.outline[0] && t < b.outline[1] + 0.2) {
    outline = interpolate(t - b.outline[0], [0, 0.45], [0, 1], { ...clamp, easing: EASE_IN });
    outlineOpacity = interpolate(t, [b.outline[1], b.outline[1] + 0.18], [1, 0], clamp);
  }
  const v = visualAt(sb, t);
  return (
    <AbsoluteFill style={{ clipPath: bgClip }}>
      {b.bg === "texture" ? <TextureBg sb={sb} /> : <BrandBg sb={sb} />}
      {divider !== null && v.src ? (
        <AbsoluteFill style={{ clipPath: `inset(0 ${W - divider}px 0 0)` }}>
          <PersonAligned sb={sb} t={t}>{(vv) => <Video src={staticFile(vv.src!)} muted trimBefore={Math.round((vv.srcStart + b.start) * sb.fps)} style={{ width: vv.srcW, height: vv.srcH }} />}</PersonAligned>
        </AbsoluteFill>
      ) : null}
      {outline > 0 && b.matteDir ? <Cutout sb={sb} t={t} dir={b.matteDir} start={b.matteStart} prefix="o" style={{ clipPath: `inset(0 0 ${(1 - outline) * 100}% 0)`, opacity: outlineOpacity, filter: "drop-shadow(0 0 10px rgba(255,255,255,0.35))" }} /> : null}
      <Cutout sb={sb} t={t} dir={b.matteDir} start={b.matteStart} />
      {divider !== null ? (
        <>
          <div style={{ position: "absolute", left: divider - 2, top: 0, width: 4, height: H, background: "#F5F5F3", boxShadow: "0 0 18px rgba(0,0,0,0.4)" }} />
          <div style={{ position: "absolute", left: divider - 30, top: H * 0.8, width: 60, height: 60, borderRadius: 30, background: "#F5F5F3", display: "flex", alignItems: "center", justifyContent: "center", color: "#171719", fontFamily: FONT_FAMILIES.onest, fontWeight: 800, fontSize: 30 }}>‹›</div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------- headline: mask reveal, underline draw, highlight sweep ----------------

const HeadlineBeat: React.FC<{ b: Extract<Beat, { kind: "headline" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const W = sb.width;
  const H = sb.height;
  const p = palette(sb);
  const px = b.size * W;
  const lineH = px * 1.02;
  const exit = interpolate(t, [b.end - 0.22, b.end], [0, 1], { ...clamp, easing: EASE_OUT });
  const top = b.y * H - (b.lines.length * lineH) / 2;
  const shade = interpolate(t, [b.start, b.start + 0.3], [0, 1], clamp) * (1 - exit);
  return (
    <AbsoluteFill>
      {/* soft dark gradient for readability over bright footage */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(23,23,25,${0.55 * shade}) 0%, rgba(23,23,25,${0.25 * shade}) ${Math.min(95, (b.y + 0.12) * 100)}%, transparent ${Math.min(100, (b.y + 0.2) * 100)}%)` }} />
      <div style={{ position: "absolute", left: 0, width: W, top, opacity: 1 - exit, transform: `translateY(${-exit * 24}px)` }}>
        {b.lines.map((l, i) => {
          const at = l.at ?? b.start + i * 0.12;
          const rp = interpolate(t, [at, at + 0.32], [0, 1], { ...clamp, easing: EASE_IN });
          const sweep = b.sweep && l.accent ? interpolate(t, [at + 0.12, at + 0.42], [0, 1], { ...clamp, easing: EASE_IN }) : 0;
          const isLast = i === b.lines.length - 1;
          const under = b.underline && isLast ? interpolate(t, [at + 0.2, at + 0.55], [0, 1], { ...clamp, easing: EASE_IN }) : 0;
          const iconPaths = b.icon && i === 0 ? ICONS[b.icon] : null;
          const iconDraw = interpolate(t, [at + 0.1, at + 0.5], [0, 1], clamp);
          return (
            <div key={i} style={{ height: lineH, display: "flex", justifyContent: "center", alignItems: "center", gap: px * 0.25 }}>
              {iconPaths ? (
                <svg width={px * 0.8} height={px * 0.8} viewBox="0 0 24 24" fill="none" stroke={p.fg} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: rp }}>
                  {iconPaths.map((d, k) => <path key={k} d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - iconDraw} />)}
                </svg>
              ) : null}
              <div style={{ position: "relative", overflow: "hidden", padding: `0 ${px * 0.12}px`, paddingBottom: px * 0.08 }}>
                <div style={{ position: "absolute", left: 0, bottom: px * 0.1, height: px * 0.82, width: `${sweep * 100}%`, background: p.accent, borderRadius: px * 0.08 }} />
                <div style={{ position: "relative", fontFamily: FONT_FAMILIES.onest, fontWeight: 800, fontSize: px, lineHeight: 1, letterSpacing: "-0.02em", color: p.fg, transform: `translateY(${(1 - rp) * 105}%)`, textShadow: sweep > 0 ? "none" : "0 4px 24px rgba(0,0,0,0.35)", whiteSpace: "nowrap" }}>
                  {l.text}
                </div>
                {b.underline && isLast ? <div style={{ position: "absolute", left: px * 0.12, bottom: 0, height: Math.max(6, px * 0.06), width: `calc(${under * 100}% - ${px * 0.24 * under}px)`, background: p.accent, borderRadius: 4 }} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      {b.behind ? <Cutout sb={sb} t={t} dir={b.matteDir} start={b.matteStart} /> : null}
    </AbsoluteFill>
  );
};

// ---------------- diagram: icon nodes + drawn connections ----------------

const DiagramBeat: React.FC<{ b: Extract<Beat, { kind: "diagram" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const W = sb.width;
  const H = sb.height;
  const p = palette(sb);
  const n = b.nodes.length;
  const d = W * 0.17;
  const span = W * 0.62;
  const xs = b.nodes.map((_, i) => W / 2 - span / 2 + (span * i) / (n - 1));
  const y = b.y * H;
  const exit = interpolate(t, [b.end - 0.22, b.end], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        {b.nodes.slice(1).map((node, i) => {
          const k = interpolate(t, [node.at - 0.3, node.at], [0, 1], { ...clamp, easing: EASE_IN });
          const x0 = xs[i]! + d / 2 + 10;
          const x1 = xs[i + 1]! - d / 2 - 10;
          const xe = x0 + (x1 - x0) * k;
          return (
            <g key={i} stroke={p.milk} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.85}>
              <line x1={x0} y1={y} x2={xe} y2={y} strokeDasharray="2 14" />
              {k > 0.95 ? <path d={`M ${x1 - 16} ${y - 12} L ${x1} ${y} L ${x1 - 16} ${y + 12}`} /> : null}
            </g>
          );
        })}
      </svg>
      {b.nodes.map((node, i) => {
        const k = interpolate(t, [node.at, node.at + 0.28], [0, 1], { ...clamp, easing: EASE_IN });
        const draw = interpolate(t, [node.at + 0.05, node.at + 0.45], [0, 1], clamp);
        const last = i === n - 1;
        return (
          <div key={i} style={{ position: "absolute", left: xs[i]! - d / 2, top: y - d / 2, width: d, height: d, borderRadius: d * 0.28, background: last ? p.pink : "rgba(247,245,242,0.04)", border: `2px solid ${last ? p.pink : "rgba(247,245,242,0.55)"}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: k, transform: `scale(${0.85 + 0.15 * k})` }}>
            <svg width={d * 0.52} height={d * 0.52} viewBox="0 0 24 24" fill="none" stroke={last ? p.graphite : p.milk} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              {(ICONS[node.icon] ?? []).map((pd, j) => <path key={j} d={pd} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />)}
            </svg>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------- punch light sweep, shape wipe ----------------

const PunchBeat: React.FC<{ b: Extract<Beat, { kind: "punch" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const k = interpolate(frame, [0, (b.end - b.start) * fps], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const x = -60 + 220 * k;
  const monoOn = b.mono && b.monoSrc && k > 0.15 && k < 0.62;
  return (
    <>
    {monoOn ? <MonoVideo sb={sb} t={t} src={b.monoSrc!} startSec={b.start} dim={0.1} /> : null}
    <AbsoluteFill style={{ background: `linear-gradient(115deg, transparent ${x - 18}%, rgba(255,255,255,0.32) ${x}%, transparent ${x + 18}%)`, mixBlendMode: "screen", opacity: Math.sin(Math.PI * k) * 0.9 + 0.1 }} />
    </>
  );
};

const ShapeWipeBeat: React.FC<{ b: Extract<Beat, { kind: "shapeWipe" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (b.end - b.start) * fps;
  const grow = interpolate(frame, [0, dur * 0.5], [0, 1], { ...clamp, easing: Easing.bezier(0.7, 0, 0.84, 0) });
  const shrink = interpolate(frame, [dur * 0.5, dur], [1, 0], { ...clamp, easing: EASE_IN });
  const s = frame < dur * 0.5 ? grow : shrink;
  const D = Math.hypot(sb.width, sb.height) * 1.15;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: D, height: D, borderRadius: D * 0.22, background: palette(sb).accent, transform: `scale(${s}) rotate(${(frame < dur * 0.5 ? 1 : -1) * (1 - s) * 25}deg)` }} />
    </AbsoluteFill>
  );
};

// ---------------- editorial poster typography ----------------

type PosterItem = Extract<Beat, { kind: "poster" }>["items"][number];
const ROLE_FONT: Record<PosterItem["role"], { family: string; weight: number; style: "normal" | "italic"; lh: number; ls: string }> = {
  sans: { family: FONT_FAMILIES.intertight, weight: 900, style: "normal", lh: 0.9, ls: "-0.045em" },
  serif: { family: FONT_FAMILIES.cormorant, weight: 600, style: "normal", lh: 1.0, ls: "0" },
  italic: { family: FONT_FAMILIES.cormorant, weight: 700, style: "italic", lh: 1.0, ls: "-0.01em" },
  script: { family: FONT_FAMILIES.badscript, weight: 400, style: "normal", lh: 1.1, ls: "0" },
};

const PosterText: React.FC<{ it: PosterItem; sb: Storyboard; t: number; end: number }> = ({ it, sb, t, end }) => {
  const p = palette(sb);
  const W = sb.width;
  const H = sb.height;
  const f = ROLE_FONT[it.role];
  const px = it.size * W;
  const color = { milk: p.milk, pink: p.pink, burgundy: p.burgundy, graphite: p.graphite }[it.color];
  const outAt = Math.min(end, it.until ?? end) - 0.22;
  const e = interpolate(t, [outAt, outAt + 0.22], [0, 1], { ...clamp, easing: EASE_OUT });
  const rp = interpolate(t, [it.at, it.at + (it.anim === "script" ? 0.55 : 0.34)], [0, 1], { ...clamp, easing: EASE_IN });
  const mv = it.move ? interpolate(t, [it.move.at, it.move.at + 0.45], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) }) : 0;
  const dy = it.move ? it.move.dy * H * mv : 0;
  const sc = (it.move ? 1 + (it.move.scale - 1) * mv : 1) * (it.anim === "scale" ? 0.93 + 0.07 * rp + 0.035 * interpolate(t, [it.at + 0.34, outAt], [0, 1], clamp) : 1);
  const base: React.CSSProperties = {
    fontFamily: f.family, fontWeight: f.weight, fontStyle: f.style, fontSize: px, lineHeight: f.lh, letterSpacing: it.tracking ? `${it.tracking}em` : f.ls,
    color, whiteSpace: "nowrap",
    textShadow: it.role === "sans" ? "0 6px 30px rgba(0,0,0,0.28)" : "0 0 22px rgba(247,245,242,0.22), 0 4px 20px rgba(0,0,0,0.35)",
  };
  let inner: React.ReactNode;
  if (it.anim === "stagger") {
    inner = [...it.text].map((ch, i) => {
      const k = interpolate(t, [it.at + i * 0.028, it.at + i * 0.028 + 0.3], [0, 1], { ...clamp, easing: EASE_IN });
      return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - k) * 105}%)`, whiteSpace: "pre" }}>{ch}</span>;
    });
  } else inner = it.text;
  const reveal: React.CSSProperties =
    it.anim === "mask" || it.anim === "scale" ? { transform: `translateY(${(1 - rp) * 105}%)` }
    : it.anim === "script" ? { clipPath: `inset(-20% ${(1 - rp) * 100}% -20% -5%)`, transform: `translateX(${(1 - rp) * -3}%)`, opacity: Math.min(1, rp * 2) }
    : it.anim === "fade" ? { opacity: rp, transform: `translateY(${(1 - rp) * 12}px)` } : {};
  const masked = it.anim === "mask" || it.anim === "stagger" || it.anim === "scale";
  return (
    <div style={{ position: "absolute", left: it.x * W, top: it.y * H + dy, transform: `translate(-50%, -50%) rotate(${it.rotate}deg) scale(${sc})`, opacity: 1 - e }}>
      <div style={{ overflow: masked ? "hidden" : "visible", padding: masked ? `0 ${px * 0.06}px ${px * 0.06}px` : 0 }}>
        <div style={{ ...base, ...reveal, translate: `0 ${-e * 40}%` }}>{inner}</div>
      </div>
    </div>
  );
};

const PosterBeat: React.FC<{ b: Extract<Beat, { kind: "poster" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = b.start + frame / fps;
  const bgIn = interpolate(t, [b.start, b.start + 0.3], [0, 1], { ...clamp, easing: EASE_IN });
  const bgOut = interpolate(t, [b.end - 0.25, b.end], [1, 0], clamp);
  const bgO = Math.min(bgIn, bgOut);
  return (
    <AbsoluteFill>
      {b.bg === "mono" && b.monoSrc ? <AbsoluteFill style={{ opacity: bgO }}><MonoVideo sb={sb} t={t} src={b.monoSrc} startSec={b.start} /></AbsoluteFill> : null}
      {b.bg === "texture" ? <AbsoluteFill style={{ opacity: bgO }}><TextureBg sb={sb} /></AbsoluteFill> : null}
      {b.bg === "shade-top" ? <AbsoluteFill style={{ opacity: bgO, background: "linear-gradient(180deg, rgba(25,25,25,0.72) 0%, rgba(25,25,25,0.35) 28%, transparent 45%)" }} /> : null}
      {b.bg === "shade-bottom" ? <AbsoluteFill style={{ opacity: bgO, background: "linear-gradient(0deg, rgba(25,25,25,0.82) 0%, rgba(25,25,25,0.55) 35%, transparent 58%)" }} /> : null}
      {b.items.filter((it) => !(b.behind && it.front)).map((it, i) => <PosterText key={i} it={it} sb={sb} t={t} end={b.end} />)}
      {b.behind ? <Cutout sb={sb} t={t} dir={b.matteDir} start={b.matteStart} /> : null}
      {b.behind ? b.items.filter((it) => it.front).map((it, i) => <PosterText key={`f${i}`} it={it} sb={sb} t={t} end={b.end} />) : null}
    </AbsoluteFill>
  );
};

const TypeWipeBeat: React.FC<{ b: Extract<Beat, { kind: "typeWipe" }>; sb: Storyboard }> = ({ b, sb }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const W = sb.width;
  const p = palette(sb);
  const k = interpolate(frame, [0, (b.end - b.start) * fps], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const pw = W * 1.7;
  const x = W - k * (W + pw);
  const px = W * 0.3;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: x, top: 0, width: pw, height: sb.height, background: p.milk, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 60px rgba(0,0,0,0.35)" }}>
        <div style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 900, fontSize: px, letterSpacing: "-0.05em", color: p.graphite, whiteSpace: "nowrap", transform: `translateX(${(0.5 - k) * 18}%)` }}>{b.text}</div>
      </div>
    </AbsoluteFill>
  );
};

export const BeatLayer: React.FC<{ b: Beat; sb: Storyboard }> = ({ b, sb }) => {
  switch (b.kind) {
    case "cutout": return <CutoutBeat b={b} sb={sb} />;
    case "headline": return <HeadlineBeat b={b} sb={sb} />;
    case "diagram": return <DiagramBeat b={b} sb={sb} />;
    case "punch": return <PunchBeat b={b} sb={sb} />;
    case "shapeWipe": return <ShapeWipeBeat b={b} sb={sb} />;
    case "poster": return <PosterBeat b={b} sb={sb} />;
    case "typeWipe": return <TypeWipeBeat b={b} sb={sb} />;
  }
};

/** Draw order: backgrounds/cutouts → graphics → headlines → transitions. */
export const beatOrder = (b: Beat) => ({ cutout: 0, diagram: 1, punch: 2, poster: 3, headline: 3, shapeWipe: 4, typeWipe: 4 })[b.kind];
/** Transitions are drawn above captions. */
export const isTransition = (b: Beat) => b.kind === "shapeWipe" || b.kind === "typeWipe";
