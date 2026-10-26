import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MotionClipProps } from "@catgpt/motion";
import { renderMotionClip } from "@catgpt/motion/render";
import { parseFfmpegInfo, run } from "./social/media/video.js";
import { ffmpegPath } from "./social/media/youtube-video.js";
import { buildRenderArgs, type RenderInput } from "./video-render-logic.js";

/**
 * Renders real Remotion clips (a title card and a transparent caption) and
 * assembles them with footage in one ffmpeg pass. Slow the first time because
 * Remotion bundles and downloads its headless browser.
 */
describe("motion graphics with Remotion and ffmpeg", () => {
  let dir: string;
  let bin: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "motion-test-"));
    bin = await ffmpegPath();
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("renders a card and a caption and places them in a 9:16 reel", async () => {
    const footage = path.join(dir, "footage.mp4");
    const card = path.join(dir, "card.mp4");
    const caption = path.join(dir, "caption.webm");
    const out = path.join(dir, "reel.mp4");

    const src = await run(bin, [
      "-y", "-hide_banner", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", footage,
    ]);
    expect(src.code).toBe(0);

    const base = { width: 720, height: 1280, durationFrames: 60, color: "#ffffff", accent: "#f5d88a", sub: null };
    const cardProps: MotionClipProps = { ...base, mode: "card", text: "Visit us today", background: "#1d3b2a" };
    const captionProps: MotionClipProps = { ...base, mode: "caption", text: "Fresh daily", background: "transparent" };
    await renderMotionClip(cardProps, card);
    await renderMotionClip(captionProps, caption);

    const inputs: RenderInput[] = [
      { shotId: "1", kind: "video", sourceStartSec: 0, lengthSec: 2, path: footage, hasAudio: false, captionPath: caption },
      { shotId: "2", kind: "video", sourceStartSec: 0, lengthSec: 2, path: card, hasAudio: false },
    ];
    const render = await run(bin, buildRenderArgs(inputs, { w: 720, h: 1280 }, out));
    expect(render.code, render.stderr.slice(-800)).toBe(0);

    const info = parseFfmpegInfo((await run(bin, ["-hide_banner", "-i", out])).stderr);
    expect(info).not.toBeNull();
    expect(info!.width).toBe(720);
    expect(info!.height).toBe(1280);
    expect(Math.abs(info!.durationSec - 4)).toBeLessThan(0.5);
  }, 300_000);
});
