import { Video } from "@remotion/media";
import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

/**
 * Render benchmark: a workload close to a real Reels edit (video + blurred fill,
 * spring title, word-by-word captions, progress bar). Used by `npm run bench`
 * to measure cloud render speed. Not a production composition.
 * Rule learned here: heavy pixel effects (blur, grading) are baked by ffmpeg; Remotion draws overlays.
 */
export const benchSchema = z.object({ video: z.string(), blurredFill: z.string(), durationSec: z.number() });

const WORDS = "Бүгін мен сіздерге қысқа видеоны қалай монтаждау керектігін көрсетемін Әр кадр маңызды".split(" ");

export const RenderBenchmark: React.FC<z.infer<typeof benchSchema>> = ({ video, blurredFill }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const title = spring({ frame: frame % (fps * 6), fps, config: { damping: 14 } });
  const wordIdx = Math.floor(frame / (fps * 0.4)) % WORDS.length;
  const line = WORDS.slice(Math.floor(wordIdx / 4) * 4, Math.floor(wordIdx / 4) * 4 + 4);
  return (
    <AbsoluteFill style={{ backgroundColor: "#141414" }}>
      {/* Blur is pre-rendered by ffmpeg: CSS blur on full-frame video is ~3x slower on CPU-only cloud. */}
      <AbsoluteFill>
        <Video src={staticFile(blurredFill)} muted objectFit="cover" style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
      <AbsoluteFill>
        <Video src={staticFile(video)} muted objectFit="contain" style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 260, width: "100%", textAlign: "center", transform: `scale(${title})`, fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 96, color: "#F7F5F2", textShadow: "0 8px 30px rgba(0,0,0,.5)" }}>
        Қысқа видео
      </div>
      <div style={{ position: "absolute", bottom: 520, width: "100%", textAlign: "center", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 64, color: "#fff" }}>
        {line.map((w, i) => {
          const active = WORDS.indexOf(w) === wordIdx;
          return (
            <span key={i} style={{ margin: "0 10px", padding: "4px 12px", borderRadius: 14, background: active ? "#6B1732" : "transparent", display: "inline-block", transform: `scale(${active ? 1.08 : 1})` }}>
              {w}
            </span>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 120, left: 80, height: 10, borderRadius: 5, background: "#6B1732", width: interpolate(frame, [0, durationInFrames], [0, width - 160]) }} />
    </AbsoluteFill>
  );
};
