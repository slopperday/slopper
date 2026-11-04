import { Composition } from "remotion";
import { STUDIO_FRAMES, StudioDemo } from "./StudioDemo";
import { VISION_FRAMES, VisionPromo } from "./VisionPromo";

const SIZES = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/**
 * Each cut in both orientations: `vision-portrait` is the one on the Slopper
 * slop, `studio-portrait` the one on Slopper Studio.
 */
export function Root() {
  return (
    <>
      {Object.entries(SIZES).map(([orientation, size]) => (
        <Composition
          key={`vision-${orientation}`}
          id={`vision-${orientation}`}
          component={VisionPromo}
          durationInFrames={VISION_FRAMES}
          fps={30}
          {...size}
        />
      ))}
      {Object.entries(SIZES).map(([orientation, size]) => (
        <Composition
          key={`studio-${orientation}`}
          id={`studio-${orientation}`}
          component={StudioDemo}
          durationInFrames={STUDIO_FRAMES}
          fps={30}
          {...size}
        />
      ))}
    </>
  );
}
