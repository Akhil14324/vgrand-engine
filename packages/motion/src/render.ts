import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { MOTION_COMPOSITION_ID, MOTION_ENTRY } from "./index";
import type { MotionClipProps } from "./props";

/**
 * Server-side Remotion rendering. Kept out of the package entry so the web app
 * never loads the bundler. The first call bundles the compositions (slow);
 * later calls reuse the bundle.
 */
let serveUrl: Promise<string> | null = null;

function bundled(): Promise<string> {
  serveUrl ??= bundle({ entryPoint: MOTION_ENTRY }).catch((err: unknown) => {
    serveUrl = null;
    throw err;
  });
  return serveUrl;
}

/**
 * Renders one clip to `outPath`. `card` is an opaque MP4 (H.264). `caption` is a
 * WebM with an alpha channel (VP9), so it can be overlaid on footage.
 */
export async function renderMotionClip(props: MotionClipProps, outPath: string): Promise<void> {
  const url = await bundled();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl: url, id: MOTION_COMPOSITION_ID, inputProps });
  const caption = props.mode === "caption";
  await renderMedia({
    composition,
    serveUrl: url,
    inputProps,
    outputLocation: outPath,
    codec: caption ? "vp9" : "h264",
    pixelFormat: caption ? "yuva420p" : "yuv420p",
    imageFormat: caption ? "png" : "jpeg",
    logLevel: "error",
  });
}
