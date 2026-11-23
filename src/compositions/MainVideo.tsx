import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, staticFile, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";

/**
 * Phase 3 core composition: source video (or brand background) + audio track.
 * Typography, motion, smart layout and captions are layered on in Phases 4–6
 * and driven by the approved storyboard.json.
 */
export const mainVideoSchema = z.object({
  /** Path relative to the project folder (served as publicDir), e.g. "work/proxy.mp4". */
  video: z.string().nullable(),
  audio: z.string().nullable(),
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  background: z.string(),
});
export type MainVideoProps = z.infer<typeof mainVideoSchema>;

export const calculateMainMetadata: CalculateMetadataFunction<MainVideoProps> = ({ props }) => ({
  fps: props.fps,
  durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
});

export const MainVideo: React.FC<MainVideoProps> = ({ video, audio, background }) => (
  <AbsoluteFill style={{ backgroundColor: background }}>
    {video ? (
      // Temporary fit until the Smart Crop engine (Phase 5): never stretch, keep proportions.
      <Video src={staticFile(video)} muted={audio !== null} objectFit="contain" style={{ width: "100%", height: "100%" }} />
    ) : null}
    {audio ? <Audio src={staticFile(audio)} /> : null}
  </AbsoluteFill>
);
