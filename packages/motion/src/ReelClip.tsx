import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/** Fills the frame; plain divs keep the React and Remotion typings in step. */
const fill: React.CSSProperties = { position: "absolute", inset: 0, display: "flex" };

import type { MotionClipProps } from "./props";

const FADE_FRAMES = 12;
const FONT = "Inter, Arial, Helvetica, sans-serif";

export const ReelClip: React.FC<MotionClipProps> = ({ mode, text, sub, background, color, accent, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, durationFrames - FADE_FRAMES, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  if (mode === "caption") {
    return (
      <div style={{ ...fill, background: "transparent", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", paddingBottom: "14%" }}>
        <div
          style={{
            opacity,
            maxWidth: "86%",
            padding: `${width * 0.025}px ${width * 0.04}px`,
            borderRadius: width * 0.02,
            background: "rgba(0,0,0,0.55)",
            color,
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: width * 0.052,
            lineHeight: 1.2,
            textAlign: "center",
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...fill,
        background,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: width * 0.08,
        opacity,
        fontFamily: FONT,
        textAlign: "center",
      }}
    >
      <div style={{ color, fontWeight: 800, fontSize: width * 0.1, lineHeight: 1.1, letterSpacing: -1 }}>{text}</div>
      {sub && (
        <div style={{ marginTop: width * 0.05, color: accent, fontWeight: 600, fontSize: width * 0.05 }}>{sub}</div>
      )}
    </div>
  );
};
