import { Composition } from "remotion";
import { FORMATS } from "./formats";
import { MainVideo, mainVideoSchema, calculateMainMetadata } from "./compositions/MainVideo";
import { RenderBenchmark, benchSchema } from "./compositions/RenderBenchmark";
import { Edit, editSchema, calculateEditMetadata } from "./compositions/Edit";
import { EXAMPLE_STORYBOARD } from "./storyboard/example";
import { Cover, coverSchema } from "./compositions/Cover";
import { Showcase, showcaseProps, calculateShowcaseMetadata } from "./compositions/Showcase";

export const Root: React.FC = () => (
  <>
    <Composition
      id="Edit"
      component={Edit}
      schema={editSchema}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={120}
      defaultProps={{ storyboard: EXAMPLE_STORYBOARD, guides: null, useMattes: false }}
      calculateMetadata={calculateEditMetadata}
    />
    <Composition
      id="Showcase"
      component={Showcase}
      schema={showcaseProps}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={30}
      defaultProps={{ spec: null as never, matteFrames: 0, sfxDir: "work/sfx", guides: false }}
      calculateMetadata={calculateShowcaseMetadata}
    />
    <Composition
      id="Cover"
      component={Cover}
      schema={coverSchema}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      defaultProps={{ width: 1080, height: 1920, frame: null, cutout: null, srcW: 1080, srcH: 1920, face: null, word: "REELS", title: "Монтаж *за 5 минут*", tag: "Сабақ 1", colors: { text: "#FFFFFF", accent: "#6B1732", onAccent: "#FFFFFF" } }}
      calculateMetadata={({ props }) => ({ width: props.width, height: props.height })}
    />
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
