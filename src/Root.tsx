import { Composition } from "remotion";
import { FORMATS } from "./formats";
import { MainVideo, mainVideoSchema, calculateMainMetadata } from "./compositions/MainVideo";

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
  </>
);
