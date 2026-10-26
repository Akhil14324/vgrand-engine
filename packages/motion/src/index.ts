import { fileURLToPath } from "node:url";

export type { MotionClipProps } from "./props";

/** Entry file the Remotion bundler starts from. */
export const MOTION_ENTRY = fileURLToPath(new URL("./entry.ts", import.meta.url));
export const MOTION_COMPOSITION_ID = "ReelClip";
export const MOTION_FPS = 30;
