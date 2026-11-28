import "@fontsource/noto-sans-display/800.css";
import "@fontsource/noto-sans/600.css";
import "@fontsource/noto-sans/700.css";
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, Video, staticFile, useCurrentFrame, continueRender, delayRender } from "remotion";
import { z } from "zod";
import { ShowcaseSchema, showcaseDuration, zoomAt, type Effect, type Showcase as Spec } from "../showcase/spec";

export const showcaseProps = z.object({ spec: ShowcaseSchema, matteFrames: z.number().int().nonnegative(), sfxDir: z.string(), guides: z.boolean().default(false) });
type Props = z.infer<typeof showcaseProps>;

export const calculateShowcaseMetadata = ({ props }: { props: Props }) => ({ durationInFrames: Math.round(showcaseDuration(props.spec) * props.spec.fps) });

const W = 1080;
const H = 1920;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const p = clamp01(x); return 1 - Math.pow(1 - p, 3); };
const smooth = (x: number) => { const p = clamp01(x); return p * p * (3 - 2 * p); };
/** 0→1 over [a, a+d], 1→0 over [b-d2, b]. */
const life = (t: number, a: number, b: number, d = 0.25, d2 = 0.25) => Math.min(ease((t - a) / d), smooth((b - t) / d2));

let fontsReady = false;
function useFonts(spec: Spec) {
  const [h] = React.useState(() => (fontsReady || typeof document === "undefined" ? null : delayRender("showcase fonts")));
  React.useEffect(() => {
    if (h === null) return;
    Promise.all([`800 100px "${spec.fonts.display}"`, `600 60px "${spec.fonts.text}"`, `700 60px "${spec.fonts.text}"`].map((f) => document.fonts.load(f, "ӘҒҚҢӨҰҮҺІ әғқңөұүһі")))
      .then(() => { fontsReady = true; continueRender(h); })
      .catch(() => continueRender(h));
  }, [h, spec.fonts.display, spec.fonts.text]);
}

// ---------------- icons (line icons, 24×24 viewBox) ----------------
const Icon: React.FC<{ name: string; size: number; color: string; stroke?: number }> = ({ name, size, color, stroke = 2 }) => {
  const p = { fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {name === "layers" ? (<><rect x="3" y="3" width="13" height="10" rx="2" {...p} /><rect x="8" y="10" width="13" height="10" rx="2" {...p} fill={color} fillOpacity={0.25} /></>) : null}
      {name === "frame" ? (<><rect x="3" y="5" width="18" height="14" rx="2" {...p} /><path d="M3 9h18M7 5v4M12 5v4M17 5v4" {...p} /></>) : null}
      {name === "T" ? <path d="M5 5h14M12 5v14M9 19h6" {...p} /> : null}
      {name === "play" ? (<><rect x="2.5" y="4" width="19" height="16" rx="3" {...p} /><path d="M10 8.5v7l6-3.5z" {...p} fill={color} /></>) : null}
      {name === "wave" ? <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" {...p} /> : null}
      {name === "cut" ? (<><circle cx="6" cy="7" r="3" {...p} /><circle cx="6" cy="17" r="3" {...p} /><path d="M8.5 8.5L20 18M8.5 15.5L20 6" {...p} /></>) : null}
    </svg>
  );
};

const CC: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <div style={{ width: size * 1.3, height: size, borderRadius: size * 0.18, border: `${size * 0.08}px solid ${color}`, color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.5, letterSpacing: -1 }}>CC</div>
);

const Speaker: React.FC<{ size: number; color: string; accent: string; waves: number }> = ({ size, color, accent, waves }) => (
  <svg width={size * 1.5} height={size} viewBox="0 0 36 24">
    <path d="M3 9h4l5-4v14l-5-4H3z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    {[0, 1, 2].map((i) => {
      const k = clamp01(waves * 3 - i);
      const r = 5 + i * 4.5;
      return <path key={i} d={`M${14 + r * 0.3} ${12 - r} A ${r} ${r} 0 0 1 ${14 + r * 0.3} ${12 + r}`} fill="none" stroke={i === 0 ? accent : color} strokeWidth={2.2} strokeLinecap="round" opacity={k} transform={`translate(${(1 - k) * -3} 0)`} />;
    })}
  </svg>
);

// ---------------- layers under the person ----------------
const matteSrc = (spec: Spec, idx: number) => staticFile(`${spec.matteDir}/${String(idx).padStart(5, "0")}.webp`);

const Behind: React.FC<{ e: Extract<Effect, { type: "behind" }>; t: number; spec: Spec }> = ({ e, t, spec }) => {
  const out = smooth((e.end - t) / 0.3);
  const letters = [...e.text];
  return (
    <div style={{ position: "absolute", left: 0, top: e.y - e.size * 0.62, width: W, height: e.size * 1.24, display: "flex", justifyContent: "center", alignItems: "center", opacity: out }}>
      <div style={{ position: "absolute", left: 40, right: 40, top: e.size * 0.05, bottom: e.size * 0.05, background: "radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0) 72%)" }} />
      <div style={{ display: "flex", fontFamily: spec.fonts.display, fontWeight: 800, fontSize: e.size, lineHeight: 1, color: e.color ?? spec.colors.light, letterSpacing: e.size * -0.01, textShadow: "0 6px 30px rgba(0,0,0,0.25)" }}>
        {letters.map((ch, i) => {
          const n = letters.length;
          if (e.anim === "rise") {
            const k = ease((t - e.start - i * 0.07) / 0.32);
            return <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: k, transform: `translateY(${(1 - k) * e.size * 0.35}px)` }}>{ch}</span>;
          }
          // open: from the centre outwards, each letter unmasks bottom→top
          const order = Math.abs(i - (n - 1) / 2);
          const k = ease((t - e.start - order * 0.05) / 0.35);
          return <span key={i} style={{ display: "inline-block", whiteSpace: "pre", clipPath: `inset(${(1 - k) * 100}% 0 0 0)`, transform: `translateY(${(1 - k) * e.size * 0.12}px)` }}>{ch}</span>;
        })}
      </div>
    </div>
  );
};

const Background: React.FC<{ e: Extract<Effect, { type: "background" }>; t: number }> = ({ e, t }) => {
  const w = ease((t - e.wipeAt) / e.wipeDur);
  const s = e.slideAt !== undefined ? smooth((t - e.slideAt) / (e.slideDur ?? 0.5)) * (e.slideX ?? 0) : 0;
  const o = smooth((e.end - t) / e.fadeOut);
  const edge = w > 0 && w < 1;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div style={{ position: "absolute", left: s, top: 0, width: W, height: H, clipPath: `inset(0 ${(1 - w) * 100}% 0 0)`, background: `radial-gradient(ellipse at 50% 35%, ${e.color} 0%, ${e.color} 45%, #4a1022 100%)`, boxShadow: s > 0 ? "-30px 0 60px rgba(0,0,0,0.45)" : undefined }} />
      {edge ? <div style={{ position: "absolute", left: w * W - 3, top: 0, width: 6, height: H, background: "rgba(255,255,255,0.85)", boxShadow: "0 0 24px rgba(255,255,255,0.8)" }} /> : null}
    </AbsoluteFill>
  );
};

const Sweep: React.FC<{ e: Extract<Effect, { type: "sweep" }>; t: number }> = ({ e, t }) => {
  const p = (t - e.start) / e.dur;
  if (p < 0 || p > 1) return null;
  const x = -500 + p * (W + 1000);
  return <div style={{ position: "absolute", left: x - 300, top: -200, width: 600, height: H + 400, transform: "rotate(14deg)", background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,244,236,0.75) 50%, rgba(255,255,255,0) 100%)", mixBlendMode: "screen" }} />;
};

const Contour: React.FC<{ e: Extract<Effect, { type: "contour" }>; t: number; src: string }> = ({ e, t, src }) => {
  const p = smooth((t - e.start) / e.drawDur);
  const o = smooth((e.end - t) / 0.35);
  if (p <= 0 || o <= 0) return null;
  const mask = `conic-gradient(from ${e.fromDeg}deg at ${e.cx}px ${e.cy}px, #000 0deg, #000 ${p * 360}deg, transparent ${p * 360 + 0.5}deg)`;
  // Ring strictly OUTSIDE the silhouette: binarised alpha → dilate → minus the silhouette → white.
  // (Motion-blurred hands are semi-transparent in the matte; binarising keeps the line off the hand itself.)
  const fid = `ring-${Math.round(e.start * 100)}`;
  return (
    <AbsoluteFill style={{ opacity: o, WebkitMaskImage: mask, maskImage: mask }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={fid} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feComponentTransfer in="SourceAlpha" result="bin"><feFuncA type="discrete" tableValues="0 0 1 1 1" /></feComponentTransfer>
          <feMorphology in="bin" operator="dilate" radius={e.width} result="fat" />
          <feComposite in="fat" in2="bin" operator="out" result="ring" />
          <feGaussianBlur in="ring" stdDeviation="0.8" result="soft" />
          <feFlood floodColor="#FFFFFF" result="white" />
          <feComposite in="white" in2="soft" operator="in" />
        </filter>
      </svg>
      <Img src={src} style={{ width: W, height: H, filter: `url(#${fid})` }} />
    </AbsoluteFill>
  );
};

// ---------------- screen-space graphics ----------------
const Shade: React.FC<{ y: number; o: number }> = ({ y, o }) => (
  <div style={{ position: "absolute", left: 0, top: y - 230, width: W, height: 460, opacity: o, background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 45%, rgba(0,0,0,0.42) 60%, rgba(0,0,0,0) 100%)" }} />
);

const Label: React.FC<{ e: Extract<Effect, { type: "label" }>; t: number; spec: Spec }> = ({ e, t, spec }) => {
  const o = smooth((e.end - t) / 0.2);
  const lines = e.breakAt !== undefined ? [e.words.slice(0, e.breakAt), e.words.slice(e.breakAt)] : [e.words];
  const iconK = e.icon ? ease((t - (e.iconAt ?? e.start)) / 0.3) : 0;
  const ul = e.underlineAt !== undefined ? ease((t - e.underlineAt) / 0.35) : 0;
  const waves = e.wavesAt !== undefined ? clamp01((t - e.wavesAt) / 0.45) : 0;
  let wi = 0;
  return (
    <>
      <Shade y={e.y} o={o * ease((t - e.start) / 0.2)} />
      <div style={{ position: "absolute", left: e.x - 420, width: 840, top: e.y - 120, height: 240, display: "flex", alignItems: "center", justifyContent: "center", gap: 22, opacity: o }}>
        {e.icon ? (
          <div style={{ transform: `scale(${0.6 + 0.4 * iconK})`, opacity: iconK, flex: "none" }}>
            {e.icon === "cc" ? <CC size={e.size * 0.95} color={spec.colors.light} /> : e.icon === "speaker" ? <div style={{ background: spec.colors.accent, borderRadius: 18, padding: "10px 14px", display: "flex" }}><Speaker size={e.size * 0.95} color={spec.colors.light} accent={spec.colors.light} waves={waves} /></div> : <div style={{ background: spec.colors.accent, borderRadius: 18, padding: 10, display: "flex" }}><Icon name={e.icon} size={e.size * 0.95} color={spec.colors.light} /></div>}
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", alignItems: e.icon ? "flex-start" : "center" }}>
          {lines.map((ln, li) => (
            <div key={li} style={{ display: "flex", gap: e.size * 0.28, fontFamily: spec.fonts.display, fontWeight: 800, fontSize: e.size, lineHeight: 1.12, color: spec.colors.light, textShadow: "0 3px 18px rgba(0,0,0,0.45)" }}>
              {ln.map((w) => {
                const idx = wi++;
                const k = ease((t - w.at) / 0.22);
                return (
                  <span key={idx} style={{ position: "relative", display: "inline-block", opacity: k, transform: `translateY(${(1 - k) * 18}px)` }}>
                    {w.text}
                    {e.underlineWord === idx ? <span style={{ position: "absolute", left: 0, bottom: -e.size * 0.08, height: e.size * 0.12, width: `${ul * 100}%`, background: spec.colors.accent, borderRadius: 6 }} /> : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

const Schema: React.FC<{ e: Extract<Effect, { type: "schema" }>; t: number; spec: Spec }> = ({ e, t, spec }) => {
  const n = e.items.length;
  const node = 112;
  const gap = 150;
  const total = n * node + (n - 1) * gap;
  const x0 = 500 - total / 2;
  const o = smooth((e.end - t) / 0.3);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, opacity: o }}>
      <div style={{ position: "absolute", left: x0 - 40, top: e.y - node / 2 - 30, width: total + 80, height: node + 110, borderRadius: 40, background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 75%)" }} />
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        {e.items.slice(1).map((it, i) => {
          const k = ease((t - it.at + 0.25) / 0.3);
          const xa = x0 + i * (node + gap) + node + 8;
          const xb = xa + gap - 16;
          return <line key={i} x1={xa} y1={e.y} x2={xa + (xb - xa) * k} y2={e.y} stroke={spec.colors.accent} strokeWidth={9} strokeLinecap="round" />;
        })}
      </svg>
      {e.items.map((it, i) => {
        const k = ease((t - it.at) / 0.3);
        const x = x0 + i * (node + gap);
        return (
          <div key={i} style={{ position: "absolute", left: x, top: e.y - node / 2, width: node, opacity: k, transform: `scale(${0.6 + 0.4 * k})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: node, height: node, borderRadius: 28, background: i === n - 1 ? spec.colors.accent : spec.colors.light, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 30px rgba(0,0,0,0.3)" }}>
              <Icon name={it.icon} size={node * 0.6} color={i === n - 1 ? spec.colors.light : spec.colors.accent} stroke={2.4} />
            </div>
            <div style={{ marginTop: 10, fontFamily: spec.fonts.text, fontWeight: 700, fontSize: 34, color: spec.colors.light, textShadow: "0 2px 12px rgba(0,0,0,0.6)", whiteSpace: "nowrap" }}>{it.label}</div>
          </div>
        );
      })}
    </div>
  );
};

const Timeline: React.FC<{ e: Extract<Effect, { type: "timeline" }>; t: number; spec: Spec }> = ({ e, t, spec }) => {
  const o = Math.min(ease((t - e.start) / 0.25), smooth((e.fadeAt + 0.45 - t) / 0.45));
  const w = 780;
  const x = 500 - w / 2;
  const rowH = 58;
  const head = ease((t - e.start) / Math.max(0.3, e.fadeAt - e.start));
  return (
    <div style={{ position: "absolute", left: x, top: e.y - (e.tracks.length * (rowH + 10) + 20) / 2, width: w, padding: 14, borderRadius: 22, background: "rgba(17,17,17,0.72)", border: "1px solid rgba(255,255,255,0.18)", opacity: o }}>
      {e.tracks.map((tr, i) => {
        const k = ease((t - tr.at) / 0.3);
        const colors = [spec.colors.accent, "#FFFFFF", "#B9B5AE"];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, height: rowH, marginBottom: 10, opacity: k, transform: `translateX(${(1 - k) * -80}px)` }}>
            <div style={{ width: rowH, height: rowH, borderRadius: 10, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={tr.icon} size={30} color="#FFFFFF" /></div>
            <div style={{ flex: 1, height: rowH - 14, borderRadius: 8, background: colors[i % 3], opacity: i === 1 ? 0.9 : 1, width: `${60 + i * 12}%` }} />
          </div>
        );
      })}
      <div style={{ position: "absolute", top: 8, bottom: 8, left: 14 + rowH + 12 + head * (w - rowH - 40), width: 4, borderRadius: 2, background: "#FFFFFF", boxShadow: "0 0 10px #fff" }} />
    </div>
  );
};

const Plate: React.FC<{ e: Extract<Effect, { type: "plate" }>; t: number; spec: Spec }> = ({ e, t, spec }) => {
  const k = ease((t - e.start) / 0.35);
  const o = smooth((e.end - t) / 0.25);
  return (
    <div style={{ position: "absolute", left: e.x - 420, width: 840, top: e.y - 60, height: 120, display: "flex", justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ background: spec.colors.accent, borderRadius: 26, padding: "18px 40px", clipPath: `inset(0 ${(1 - k) * 100}% 0 0 round 26px)`, boxShadow: "0 18px 40px rgba(0,0,0,0.35)", fontFamily: spec.fonts.display, fontWeight: 800, fontSize: 64, color: spec.colors.light, whiteSpace: "nowrap" }}>{e.text}</div>
    </div>
  );
};

const Comment: React.FC<{ e: Extract<Effect, { type: "comment" }>; t: number; spec: Spec }> = ({ e, t, spec }) => {
  const k = ease((t - e.start) / 0.35);
  const n = Math.max(0, Math.min(e.typed.length, Math.floor((t - e.typeAt) / e.charDur) + 1));
  const typed = t >= e.typeAt ? e.typed.slice(0, n) : "";
  const caret = Math.floor(t * 2.5) % 2 === 0;
  const ctaK = ease((t - e.ctaAt) / 0.35);
  const [pre = "", post = ""] = e.cta.split(e.ctaAccent);
  const x0 = 70;
  const w = 650;
  return (
    <>
      <Shade y={e.y - 40} o={k} />
      <div style={{ position: "absolute", left: x0, top: e.y - 175, width: w, textAlign: "left", opacity: ctaK, transform: `translateY(${(1 - ctaK) * 16}px)`, fontFamily: spec.fonts.display, fontWeight: 800, fontSize: 58, lineHeight: 1.1, color: spec.colors.light, textShadow: "0 3px 16px rgba(0,0,0,0.5)" }}>
        {pre}<span style={{ color: spec.colors.light, background: spec.colors.accent, borderRadius: 12, padding: "0 8px" }}>{e.ctaAccent}</span>{post.split(" ")[0]}
        <br />
        {post.split(" ").slice(1).join(" ")}
      </div>
      <div style={{ position: "absolute", left: x0, top: e.y - 50, width: w, height: 100, borderRadius: 50, background: "#FFFFFF", boxShadow: "0 16px 40px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", gap: 18, padding: "0 26px", opacity: k, transform: `translateY(${(1 - k) * 40}px) scale(${0.92 + 0.08 * k})`, transformOrigin: "left center" }}>
        <div style={{ width: 58, height: 58, borderRadius: 29, background: `linear-gradient(135deg, ${spec.colors.accent}, #C2456B)`, flex: "none" }} />
        <div style={{ fontFamily: spec.fonts.text, fontWeight: 700, fontSize: 46, color: typed ? spec.colors.dark : "#9A9A9A", flex: 1, whiteSpace: "nowrap" }}>
          {typed ? <span style={{ color: spec.colors.accent }}>{typed}</span> : "Пікір қосу…"}
          <span style={{ display: "inline-block", width: 4, height: 48, marginLeft: 4, verticalAlign: "middle", background: spec.colors.dark, opacity: caret ? 1 : 0 }} />
        </div>
        <div style={{ fontFamily: spec.fonts.text, fontWeight: 700, fontSize: 36, color: typed.length === e.typed.length ? spec.colors.accent : "#C9C9C9" }}>↑</div>
      </div>
    </>
  );
};

// ---------------- main ----------------
export const Showcase: React.FC<Props> = ({ spec, matteFrames, sfxDir, guides }) => {
  useFonts(spec);
  const frame = useCurrentFrame();
  const t = frame / spec.fps;
  const frozen = t >= spec.srcDuration - 1 / spec.fps;
  const idx = Math.max(1, Math.min(matteFrames, frame + 1));
  const z = zoomAt(spec.zoom, Math.min(t, spec.srcDuration));
  const ox = z.ax * W;
  const oy = z.ay * H;
  const active = (e: Effect) => t >= e.start && t <= e.end;
  const under = spec.effects.filter((e) => (e.type === "background" || e.type === "behind" || e.type === "contour" || e.type === "sweep") && t >= e.start - 0.05 && t <= e.end + 0.05);
  const needMatte = under.length > 0 && matteFrames > 0;
  const over = spec.effects.filter((e) => active(e) && (e.type === "label" || e.type === "schema" || e.type === "timeline" || e.type === "plate" || e.type === "comment"));
  const cap = spec.captions.find((c) => t >= c.start && t < c.end);
  const mSrc = matteSrc(spec, idx);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transformOrigin: `${ox}px ${oy}px`, transform: `scale(${z.zoom})` }}>
        {frozen && spec.lastFrame ? <Img src={staticFile(spec.lastFrame)} style={{ width: W, height: H }} /> : <Video src={staticFile(spec.video)} muted style={{ width: W, height: H }} />}
        {under.map((e, i) =>
          e.type === "background" ? <Background key={i} e={e} t={t} /> : e.type === "sweep" ? <Sweep key={i} e={e} t={t} /> : e.type === "behind" ? <Behind key={i} e={e} t={t} spec={spec} /> : e.type === "contour" ? <Contour key={i} e={e} t={t} src={mSrc} /> : null,
        )}
        {needMatte ? <Img src={mSrc} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} /> : null}
      </AbsoluteFill>
      {over.map((e, i) =>
        e.type === "label" ? <Label key={i} e={e} t={t} spec={spec} /> : e.type === "schema" ? <Schema key={i} e={e} t={t} spec={spec} /> : e.type === "timeline" ? <Timeline key={i} e={e} t={t} spec={spec} /> : e.type === "plate" ? <Plate key={i} e={e} t={t} spec={spec} /> : e.type === "comment" ? <Comment key={i} e={e} t={t} spec={spec} /> : null,
      )}
      {cap ? (
        <>
          <Shade y={cap.y} o={Math.min(ease((t - cap.start) / 0.12), 1)} />
          <div style={{ position: "absolute", left: 478 - 400, width: 800, top: cap.y - 80, height: 160, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: spec.fonts.text, fontWeight: 600, fontSize: 56, lineHeight: 1.15, color: spec.colors.light, textShadow: "0 3px 14px rgba(0,0,0,0.55)" }}>{cap.text}</div>
        </>
      ) : null}
      <Audio src={staticFile(spec.voice)} />
      {spec.sfx.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * spec.fps)} durationInFrames={Math.round(1.2 * spec.fps)}>
          <Audio src={staticFile(`${sfxDir}/${s.kind}.wav`)} volume={s.gain} />
        </Sequence>
      ))}
      {guides ? (
        <>
          <div style={{ position: "absolute", left: 0.065 * W, top: 0.115 * H, width: (0.86 - 0.065) * W, height: (0.77 - 0.115) * H, border: "3px dashed #FFD84D" }} />
          <div style={{ position: "absolute", left: 0.82 * W, top: 0.62 * H, width: 0.18 * W, height: 0.38 * H, background: "rgba(255,0,0,0.22)" }} />
          <div style={{ position: "absolute", left: 20, top: 20, padding: "6px 14px", borderRadius: 10, background: "rgba(0,0,0,0.7)", color: "#fff", font: "700 36px Inter, sans-serif" }}>{t.toFixed(2)} с</div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

