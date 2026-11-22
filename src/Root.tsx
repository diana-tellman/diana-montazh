import { Composition } from "remotion";
import { FORMATS } from "./formats";
import { MainVideo, mainVideoSchema, calculateMainMetadata } from "./compositions/MainVideo";
import { RenderBenchmark, benchSchema } from "./compositions/RenderBenchmark";

export const Root: React.FC = () => (
  <>
    {Object.entries(FORMATS).map(([id, f]) => (
      <Composition
        key={id}
        id={`Main-${id.replace(":", "x")}`}
        component={MainVideo}
        schema={mainVideoSchema}
        width={f.width}
        height={f.height}
        fps={30}
        durationInFrames={150}
        defaultProps={{ video: null, audio: null, durationSec: 5, fps: 30, background: "#141414" }}
        calculateMetadata={calculateMainMetadata}
      />
    ))}
    <Composition
      id="RenderBenchmark"
      component={RenderBenchmark}
      schema={benchSchema}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={900}
      defaultProps={{ video: "work/video-01.mp4", blurredFill: "work/video-01.fill.mp4", durationSec: 30 }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.durationSec * 30) })}
    />
  </>
);
