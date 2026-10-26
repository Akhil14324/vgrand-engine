import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFfmpegInfo, run } from "./social/media/video.js";
import { ffmpegPath } from "./social/media/youtube-video.js";
import { buildRenderArgs } from "./video-render-logic.js";

/**
 * Renders real MP4s with the bundled ffmpeg: two synthetic clips (one with
 * audio, one landscape) and a still image, cut into a 9:16 reel. Checks that
 * the output length and frame size are what the plan asked for.
 */
describe("render with the bundled ffmpeg", () => {
  let dir: string;
  let bin: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "render-test-"));
    bin = await ffmpegPath();
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("produces a 9:16 reel of the planned length", async () => {
    const landscape = path.join(dir, "landscape.mp4");
    const still = path.join(dir, "still.png");
    const out = path.join(dir, "reel.mp4");

    // 6s landscape clip: a test pattern with a 440 Hz tone.
    const make = await run(bin, [
      "-y", "-hide_banner", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=6",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", landscape,
    ]);
    expect(make.code).toBe(0);
    const still1 = await run(bin, ["-y", "-hide_banner", "-f", "lavfi", "-i", "color=c=red:size=720x1280:duration=1", "-frames:v", "1", still]);
    expect(still1.code).toBe(0);

    const inputs = [
      { shotId: "1", fileName: "landscape.mp4", kind: "video" as const, sourceStartSec: 0, lengthSec: 4, path: landscape, hasAudio: true },
      { shotId: "2", fileName: "still.png", kind: "image" as const, sourceStartSec: 0, lengthSec: 2, path: still, hasAudio: false },
    ];
    const render = await run(bin, buildRenderArgs(inputs, { w: 720, h: 1280 }, out));
    expect(render.code, render.stderr.slice(-800)).toBe(0);

    const info = parseFfmpegInfo((await run(bin, ["-hide_banner", "-i", out])).stderr);
    expect(info).not.toBeNull();
    expect(info!.width).toBe(720);
    expect(info!.height).toBe(1280);
    expect(Math.abs(info!.durationSec - 6)).toBeLessThan(0.5);
    expect(info!.audioCodec).toBe("aac");
    expect((await readFile(out)).byteLength).toBeGreaterThan(1000);
  }, 120_000);
});
