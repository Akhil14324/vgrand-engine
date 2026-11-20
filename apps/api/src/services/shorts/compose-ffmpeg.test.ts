import { mkdtemp, mkdir, copyFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAss, evenWordTimings } from "./captions-logic.js";
import { buildComposeArgs } from "./compose-logic.js";
import { ffmpeg, probeOutput } from "./ffmpeg.js";
import { validateOutput } from "./validate-logic.js";

/** Real ffmpeg run of the Path B composition (no network, no DB). Skipped when ffmpeg/ffprobe aren't installed. */
const haveTools = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const FONTS = fileURLToPath(new URL("../../../assets/fonts", import.meta.url));

describe.skipIf(!haveTools)("compose with real ffmpeg", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "shorts-compose-"));
    const gen = (args: string[]) => ffmpeg(["-y", "-loglevel", "error", ...args], { cwd: dir });
    await gen(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "land.mp4"]);
    await gen(["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=25:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "vert.mp4"]);
    await gen(["-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*200*t):s=44100:d=16", "-c:a", "libmp3lame", "voice.mp3"]);
    await gen(["-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t):s=44100:d=5", "-c:a", "libmp3lame", "music.mp3"]);
    await mkdir(path.join(dir, "fonts"));
    for (const f of await readdir(FONTS)) if (f.endsWith(".ttf")) await copyFile(path.join(FONTS, f), path.join(dir, "fonts", f));
  }, 60_000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("produces a 1080x1920 H.264/AAC file that passes validation, looping a short clip", async () => {
    const text = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const { ass, events } = buildAss(evenWordTimings(text, 16));
    await writeFile(path.join(dir, "captions.ass"), ass);
    const args = buildComposeArgs({
      clips: [
        { path: "land.mp4", startSec: 0, lengthSec: 6, loop: false },
        { path: "vert.mp4", startSec: 0, lengthSec: 10.6, loop: true },
      ],
      voicePath: "voice.mp3",
      musicPath: "music.mp3",
      assFile: "captions.ass",
      fontsDir: "fonts",
      totalSec: 16.6,
      outFile: "out.mp4",
    });
    const r = await ffmpeg(args, { cwd: dir });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const probe = await probeOutput(path.join(dir, "out.mp4"));
    const report = validateOutput(probe, { captionEvents: events, requireCaptions: true });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(probe.durationSec).toBeCloseTo(16.6, 0);
  }, 120_000);
});
