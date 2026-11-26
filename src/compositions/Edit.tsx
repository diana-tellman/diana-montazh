import { Audio, Video } from "@remotion/media";
import { useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { ensureFontsLoaded, FONT_FAMILIES } from "../design/fonts";
import { contrastRatio, resolveStyle, type StyleDef } from "../design/styles";
import { easeInOut } from "../layout/frame";
import { personBox, personRadius, personWindow, secondaryBox, type LayoutKind } from "../layout/person";
import { BeatLayer, beatOrder, isTransition, TextureBg } from "./beats";
import { enterStyle, exitStyle, progress, unitStyle } from "../motion/anim";
import { ICONS } from "../design/icons";
import { captionBand, safeZone } from "../layout/safeZones";
import { cameraAt, layoutAt, StoryboardSchema, type BehindText, type Callout, type Caption, type Icon, type Layout, type Storyboard, type Visual } from "../storyboard/schema";

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
  const { kind, k } = layoutBlend(sb, t);
  const a = personWindow("full", v.srcW, v.srcH, sb.width, sb.height, v.framing, cam);
  const b2 = personWindow(kind, v.srcW, v.srcH, sb.width, sb.height, v.framing, cam);
  const win = kind === "pip" ? { scale: a.scale + (b2.scale - a.scale) * k, offX: a.offX + (b2.offX - a.offX) * k, offY: a.offY + (b2.offY - a.offY) * k } : b2;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: v.srcW, height: v.srcH, transformOrigin: "0 0", transform: `translate(${win.offX}px, ${win.offY}px) scale(${win.scale})` }}>
      {children}
    </div>
  );
};

/** Pip enters/leaves with a smooth 0.4 s morph from/to the full frame. */
function layoutBlend(sb: Storyboard, t: number): { kind: LayoutKind; k: number } {
  const l = sb.layouts.find((x) => t >= x.start && t < x.end);
  if (!l) return { kind: "full", k: 1 };
  if (l.kind !== "pip") return { kind: l.kind, k: 1 };
  const e = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  return { kind: "pip", k: Math.min(e((t - l.start) / 0.4), e((l.end - t) / 0.4)) };
}

/** The other part of a circle / split layout: photo (slow push), clip or brand graphic. */
const Secondary: React.FC<{ l: Layout; sb: Storyboard }> = ({ l, sb }) => {
  const frame = useCurrentFrame();
  const b = secondaryBox(l.kind, sb.width, sb.height);
  const push = 1 + 0.06 * (frame / Math.max(1, (l.end - l.start) * sb.fps));
  return (
    <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, overflow: "hidden", backgroundColor: "#141414" }}>
      {(l.kind === "pip" || l.kind === "split") && (l.secondaryKind === "graphic" || !l.secondary) ? (
        <TextureBg sb={sb} />
      ) : l.secondaryKind === "graphic" || !l.secondary ? (
        <Graphic sb={sb} />
      ) : l.secondaryKind === "photo" ? (
        <Img src={staticFile(l.secondary)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${push})` }} />
      ) : (
        <Video src={staticFile(l.secondary)} muted objectFit="cover" style={{ width: "100%", height: "100%" }} />
      )}
    </div>
  );
};

const VisualLayer: React.FC<{ v: Visual; sb: Storyboard }> = ({ v, sb }) => {
  const frame = useCurrentFrame(); // local to the Sequence
  const t = v.start + frame / sb.fps;
  if (v.kind === "graphic") return <Graphic sb={sb} />;
  const { kind, k } = layoutBlend(sb, t);
  const box = personBox(kind, sb.width, sb.height);
  const W = sb.width;
  const H = sb.height;
  const ins = kind === "pip" ? { t: box.y * k, r: (W - box.x - box.w) * k, b: (H - box.y - box.h) * k, l: box.x * k, rad: personRadius("pip", W) * k } : null;
  const clip = kind === "circle" ? `circle(${box.w / 2}px at ${box.x + box.w / 2}px ${box.y + box.h / 2}px)` : kind === "split" ? `inset(${box.y}px 0 0 0)` : ins ? `inset(${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px round ${ins.rad}px)` : "none";
  const f = (s: number) => Math.round(s * sb.fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "#141414", overflow: "hidden" }}>
      {sb.layouts.filter((l) => l.end > v.start && l.start < v.end && l.kind !== "full").map((l) => (
        <Sequence key={l.id} from={f(l.start - v.start)} durationInFrames={Math.max(1, f(l.end) - f(l.start))}>
          <Secondary l={l} sb={sb} />
        </Sequence>
      ))}
      {v.fill && kind === "full" ? <Video src={staticFile(v.fill)} muted objectFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} trimBefore={Math.round(v.srcStart * sb.fps)} /> : null}
      <AbsoluteFill style={{ clipPath: clip }}>
        <Framed v={v} sb={sb} t={t}>
          {v.kind === "video" && v.src ? (
            <Video src={staticFile(v.src)} muted trimBefore={Math.round(v.srcStart * sb.fps)} style={{ width: v.srcW, height: v.srcH }} />
          ) : v.src ? (
            <Img src={staticFile(v.src)} style={{ width: v.srcW, height: v.srcH }} />
          ) : null}
        </Framed>
      </AbsoluteFill>
      {kind === "circle" ? (
        <div style={{ position: "absolute", left: box.x - 6, top: box.y - 6, width: box.w + 12, height: box.h + 12, borderRadius: "50%", border: `10px solid ${sb.style.colors.accent === "#141414" ? "#FFFFFF" : "#FFFFFF"}`, boxShadow: `0 0 0 4px ${sb.style.colors.accent}, 0 24px 60px rgba(0,0,0,0.45)` }} />
      ) : null}
      {ins ? <div style={{ position: "absolute", left: ins.l, top: ins.t, width: W - ins.l - ins.r, height: H - ins.t - ins.b, borderRadius: ins.rad, boxShadow: `0 30px 80px rgba(0,0,0,${0.5 * k}), inset 0 0 0 2px rgba(245,245,243,${0.25 * k})` }} /> : null}
      {kind === "split" ? <div style={{ position: "absolute", left: 0, top: box.y - 4, width: sb.width, height: 8, background: sb.style.colors.accent }} /> : null}
    </AbsoluteFill>
  );
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
  const idx = String(Math.max(1, Math.round((t - b.matteStart) * fps) + 1)).padStart(5, "0");
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: b.y * sb.height - px * 0.55, textAlign: "center",
          fontFamily: FONT_FAMILIES.montserrat, fontWeight: 900, fontSize: px, lineHeight: 1, letterSpacing: "-0.02em",
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
  const band = captionBand(safeZone(sb.platform));
  const px = st.size * Math.min(sb.width, sb.height) * c.scale;
  const words = c.lines.flat();
  const activeIdx = words.reduce((acc, w, i) => (t >= w.start ? i : acc), -1);
  const perWord = st.enter === "word" || st.enter === "typewriter";
  // Block entrance / exit from the shared motion library (no bounce).
  const inP = progress(t, c.start, st.enter === "blur" ? 0.45 : 0.34);
  const e = interpolate(t, [c.end - 0.2, c.end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const enterKind = perWord ? null : st.enter === "pop" ? "scale" : st.enter === "rise" ? "fade" : st.enter === "slide" ? "slideRight" : st.enter;
  const en = enterKind ? enterStyle(enterKind as never, inP, px) : { masked: false, inner: {}, outer: {} };
  const exitS = exitStyle((st.exit ?? "fade") as never, e, px);

  const textDeco: React.CSSProperties = st.backdrop === "shadow" ? { textShadow: "0 1px 2px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.55), 0 0 22px rgba(0,0,0,0.35)" } : {};
  const plate = st.plate ?? (st.backdrop === "glass" ? "glass" : sb.style.preset === "lime" ? "solid" : "none");
  const container: React.CSSProperties =
    plate === "glass" ? { background: "rgba(20,20,22,0.55)", border: "1.5px solid rgba(255,255,255,0.25)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 12px 40px rgba(0,0,0,0.35)", borderRadius: px * 0.45, padding: `${px * 0.22}px ${px * 0.45}px` }
    : plate === "solid" ? { background: col.accent, borderRadius: px * 0.18, padding: `${px * 0.16}px ${px * 0.32}px` }
    : plate === "box" ? { border: `2px solid ${col.text}`, borderRadius: px * 0.12, padding: `${px * 0.18}px ${px * 0.4}px` }
    : {};
  const accentAsText = plate === "glass" && /^#[0-9a-f]{6}$/i.test(col.accent) && contrastRatio(col.accent, "#000000") >= 4.5;
  let wi = -1;
  const block = (
    <div style={{ ...container, display: "flex", flexDirection: "column", alignItems: "center" }}>
      {c.lines.map((line, li) => (
        <FitLine key={li} maxWidth={(band.x1 - band.x0) * sb.width - px * 1.6} frame={frame}>
          {line.map((w, k) => {
            wi++;
            const i = wi;
            const spoken = i <= activeIdx;
            const active = i === activeIdx;
            const hidden = st.upcoming === "hidden" && !spoken && !perWord;
            let color = st.upcoming === "dim" && !spoken ? col.upcoming : col.text;
            const pill = active && st.active === "pill";
            const marker = w.emphasis && !accentAsText && !pill && plate !== "solid";
            if (w.emphasis && !pill && accentAsText) color = col.accent;
            if (active && st.active === "color") color = col.accent;
            const unit = perWord ? unitStyle(st.enter === "typewriter" ? "typewriter" : "word", t, w.start - 0.04, px) : {};
            const ul = active && st.active === "underline";
            return (
              <span key={k} style={{ display: "inline-block", overflow: perWord && st.enter === "word" ? "hidden" : "visible", verticalAlign: "top", margin: `0 ${px * 0.12}px`, paddingBottom: px * 0.06 }}>
                <span
                  style={{
                    fontFamily: FONT_FAMILIES[st.font], fontWeight: st.weight, fontSize: px, lineHeight: st.lineHeight,
                    letterSpacing: `${st.letterSpacing}em`, color: pill ? col.onAccent : color,
                    padding: pill ? `${px * 0.04}px ${px * 0.2}px` : `${px * 0.04}px 0`, borderRadius: px * 0.22,
                    background: pill ? col.accent : marker ? `linear-gradient(transparent 58%, ${col.accent} 58%, ${col.accent} 92%, transparent 92%)` : "transparent",
                    opacity: hidden ? 0 : 1, display: "inline-block",
                    transform: `scale(${(w.emphasis ? st.emphasisScale : 1) * (active && st.active === "scale" ? 1.08 : 1)})`,
                    boxShadow: ul ? `inset 0 -${Math.max(4, px * 0.07)}px 0 ${col.accent}` : undefined,
                    ...unit,
                    ...(pill ? {} : textDeco),
                  }}
                >
                  {w.text}
                </span>
              </span>
            );
          })}
        </FitLine>
      ))}
    </div>
  );
  return (
    <div style={{ position: "absolute", left: band.x0 * sb.width, width: (band.x1 - band.x0) * sb.width, top: c.y * sb.height, display: "flex", justifyContent: "center" }}>
      <div style={exitS}>
        <div style={{ overflow: en.masked ? "hidden" : "visible" }}>
          <div style={{ ...en.inner, display: "flex", alignItems: "center", gap: px * 0.2 }}>
            {plate === "bracket" ? <span style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 300, fontSize: px * 1.45, color: col.text, lineHeight: 1, ...textDeco }}>[</span> : null}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {block}
              {plate === "underline" ? <div style={{ height: Math.max(4, px * 0.06), width: `${progress(t, c.start + 0.15, 0.4) * 100}%`, background: col.accent, borderRadius: 3, marginTop: px * 0.1 }} /> : null}
            </div>
            {plate === "bracket" ? <span style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 300, fontSize: px * 1.45, color: col.text, lineHeight: 1, ...textDeco }}>]</span> : null}
          </div>
        </div>
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
      <div style={{ ...style, fontFamily: FONT_FAMILIES.onest, fontWeight: 800, fontSize: px, padding: `${px * 0.45}px ${px * 0.9}px`, borderRadius: px, transform: `scale(${0.8 + 0.2 * p})` }}>{c.text}</div>
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
      {sb.behindText.map((b) => (
        <Sequence key={b.id} from={f(b.start)} durationInFrames={Math.max(1, f(b.end) - f(b.start))}>
          <BehindTextLayer b={b} sb={sb} useMattes={useMattes} />
        </Sequence>
      ))}
      {[...sb.beats].filter((b) => !isTransition(b)).sort((a, b) => beatOrder(a) - beatOrder(b)).map((b) => (
        <Sequence key={b.id} from={f(b.start)} durationInFrames={Math.max(1, f(b.end) - f(b.start))}>
          <BeatLayer b={b} sb={sb} />
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
      {sb.beats.filter(isTransition).map((b) => (
        <Sequence key={b.id} from={f(b.start)} durationInFrames={Math.max(1, f(b.end) - f(b.start))}>
          <BeatLayer b={b} sb={sb} />
        </Sequence>
      ))}
      {sb.progressBar ? <ProgressBar sb={sb} /> : null}
      <Audio src={staticFile(sb.voice.src)} volume={sb.voice.gain} />
      {sb.sfx.map((s, i) => (
        <Sequence key={`sfx${i}`} from={f(s.t)} durationInFrames={f(1.2)}>
          <Audio src={staticFile(`work/sfx/${s.kind}.wav`)} volume={s.gain} />
        </Sequence>
      ))}
      {guides ? <Guides sb={sb} g={guides} /> : null}
    </AbsoluteFill>
  );
};
