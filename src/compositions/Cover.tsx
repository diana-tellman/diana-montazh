import { AbsoluteFill, Img, staticFile } from "remotion";
import { z } from "zod";
import { ensureFontsLoaded, FONT_FAMILIES } from "../design/fonts";
import { computeWindow } from "../layout/frame";

ensureFontsLoaded();

export const coverSchema = z.object({
  width: z.number(),
  height: z.number(),
  /** Project-relative paths. */
  frame: z.string().nullable(),
  cutout: z.string().nullable(),
  srcW: z.number(),
  srcH: z.number(),
  /** Face (normalised source coords) — anchors the framing and the big word. */
  face: z.object({ cx: z.number(), cy: z.number(), headTop: z.number(), chinY: z.number() }).nullable(),
  word: z.string().nullable(),
  /** Title; *word* = accent. */
  title: z.string(),
  tag: z.string().nullable(),
  colors: z.object({ text: z.string(), accent: z.string(), onAccent: z.string() }),
});
export type CoverProps = z.infer<typeof coverSchema>;

/**
 * Cover: the real frame (never a generated face), optional giant word behind the head,
 * title kept inside the central 3:4 band so the Instagram profile grid does not crop it.
 */
export const Cover: React.FC<CoverProps> = (p) => {
  const W = p.width;
  const H = p.height;
  const anchor = p.face ? { ax: p.face.cx, ay: (p.face.headTop + p.face.chinY) / 2 } : { ax: 0.5, ay: 0.4 };
  const win = computeWindow(p.srcW, p.srcH, W, H, "cover", { zoom: 1.04, ...anchor }, { x: 0.5, y: 0.34 });
  const layer = (src: string) => (
    <div style={{ position: "absolute", left: 0, top: 0, width: p.srcW, height: p.srcH, transformOrigin: "0 0", transform: `translate(${win.offX}px, ${win.offY}px) scale(${win.scale})` }}>
      <Img src={staticFile(src)} style={{ width: p.srcW, height: p.srcH }} />
    </div>
  );
  const headTopY = p.face ? (p.face.headTop * p.srcH * win.scale + win.offY) / H : 0.2;
  const word = p.word?.toUpperCase() ?? null;
  const wordPx = word ? Math.min(0.3 * W, (0.9 * W) / (word.length * 0.84)) : 0;
  const wordTop = Math.max(0.13 * H, headTopY * H - wordPx * 0.62);
  const parts = p.title.split(/(\*[^*]+\*)/g).filter(Boolean);
  const titlePx = Math.min(0.095 * W, (0.86 * W * 2.2) / Math.max(10, p.title.replace(/\*/g, "").length * 0.6));
  return (
    <AbsoluteFill style={{ backgroundColor: "#141414", overflow: "hidden" }}>
      {p.frame ? layer(p.frame) : <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 30%, ${p.colors.accent}, #141414 65%)` }} />}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.78) 78%, rgba(0,0,0,0.9) 100%)" }} />
      {word && p.cutout ? (
        <div style={{ position: "absolute", top: wordTop, width: "100%", textAlign: "center", fontFamily: FONT_FAMILIES.intertight, fontWeight: 900, fontSize: wordPx, lineHeight: 1, letterSpacing: "-0.045em", color: p.colors.text === "#141414" ? "#FFFFFF" : p.colors.accent, textShadow: "0 12px 50px rgba(0,0,0,0.35)" }}>
          {word}
        </div>
      ) : null}
      {p.cutout ? layer(p.cutout) : null}
      {p.tag ? (
        // Above the head when there is room; otherwise just above the title (never on the face).
        <div style={{ position: "absolute", ...(headTopY > 0.24 ? { top: 0.14 * H } : { bottom: 0.15 * H + titlePx * 2.5 }), left: headTopY > 0.24 ? 0 : 0.07 * W, width: headTopY > 0.24 ? "100%" : "auto", display: "flex", justifyContent: headTopY > 0.24 ? "center" : "flex-start" }}>
          <div style={{ fontFamily: FONT_FAMILIES.intertight, fontWeight: 800, fontSize: 0.038 * W, color: "#fff", padding: `${0.014 * W}px ${0.04 * W}px`, borderRadius: 999, background: "rgba(16,18,24,0.5)", border: "2px solid rgba(255,255,255,0.35)" }}>{p.tag}</div>
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 0.07 * W, right: 0.07 * W, bottom: 0.15 * H, fontFamily: FONT_FAMILIES.intertight, fontWeight: 900, fontSize: titlePx, lineHeight: 1.0, letterSpacing: "-0.04em", color: p.colors.text, textShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
        {parts.map((s, i) =>
          s.startsWith("*") ? (
            <span key={i} style={{ fontFamily: FONT_FAMILIES.cormorant, fontStyle: "italic", fontWeight: 700, fontSize: titlePx * 1.18, letterSpacing: "-0.01em", color: p.colors.accent, padding: `0 ${titlePx * 0.08}px` }}>{s.slice(1, -1)}</span>
          ) : (
            <span key={i}>{s}</span>
          ),
        )}
      </div>
    </AbsoluteFill>
  );
};
