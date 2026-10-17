import { Composition } from "remotion";
import { VISION_FRAMES, VisionPromo } from "./VisionPromo";

const SIZES = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/** The vision cut in both orientations: `vision-portrait` is the one on the Slopper slop. */
export function Root() {
  return (
    <>
      {Object.entries(SIZES).map(([orientation, size]) => (
        <Composition
          key={orientation}
          id={`vision-${orientation}`}
          component={VisionPromo}
          durationInFrames={VISION_FRAMES}
          fps={30}
          {...size}
        />
      ))}
    </>
  );
}
