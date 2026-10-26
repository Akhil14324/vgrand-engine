import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./social/media/video.js";
import { ffmpegPath } from "./social/media/youtube-video.js";
import { analyseReel } from "./video-qa.js";

/**
 * Runs the real measurements on a clip with a known fault: 2s of black in the
 * middle and a 440 Hz tone. The black stretch must be reported and the sound
 * must be measured.
 */
describe("reel analysis with the bundled ffmpeg", () => {
  let dir: string;
  let bin: string;
  let clip: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "qa-test-"));
    bin = await ffmpegPath();
    clip = path.join(dir, "faulty.mp4");
    // Three segments joined: 2s testsrc, 2s black, 2s testsrc, with a tone running throughout.
    const made = await run(bin, [
      "-y", "-hide_banner",
      "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30:duration=2",
      "-f", "lavfi", "-i", "color=c=black:size=720x1280:rate=30:duration=2",
      "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6:sample_rate=44100",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
    ]);
    expect(made.code, made.stderr.slice(-400)).toBe(0);
  }, 120_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reports the black stretch and a sound track", async () => {
    const checks = await analyseReel(clip, { durationSec: 6, width: 720, height: 1280 });
    const black = checks.find((c) => c.id === "black")!;
    const loud = checks.find((c) => c.id === "loudness")!;
    const audio = checks.find((c) => c.id === "audio")!;
    const frame = checks.find((c) => c.id === "frame")!;

    expect(audio.status).toBe("pass");
    expect(frame.status).toBe("pass");
    expect(black.detail).toMatch(/^\d+\.\ds of black$/);
    const blackSec = Number(/^(\d+\.\d)s/.exec(black.detail)![1]);
    expect(blackSec).toBeGreaterThan(1.5);
    expect(blackSec).toBeLessThan(2.5);
    expect(loud.detail).toMatch(/LUFS/);
  }, 120_000);
});
