import type { FC } from "react";
import { Composition } from "remotion";
import { ReelClip } from "./ReelClip";
import type { MotionClipProps } from "./props";

export const FPS = 30;

/**
 * Remotion types composition props loosely (Record<string, unknown>). The clip
 * itself is typed as MotionClipProps; these casts only bridge that gap.
 */
const Clip = ReelClip as unknown as FC<Record<string, unknown>>;

/** Frame size and length come from the props, so one composition serves every shot. */
export const RemotionRoot: FC = () => (
  <Composition
    id="ReelClip"
    component={Clip}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={FPS}
    defaultProps={{
      mode: "card",
      text: "",
      sub: null,
      background: "#111111",
      color: "#ffffff",
      accent: "#ffffff",
      durationFrames: FPS,
      width: 1080,
      height: 1920,
    }}
    calculateMetadata={({ props }) => {
      const p = props as unknown as MotionClipProps;
      return { durationInFrames: p.durationFrames, width: p.width, height: p.height };
    }}
  />
);
