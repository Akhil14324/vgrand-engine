import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpeg, probeOutput } from "./ffmpeg.js";
import { cardTheme, graphicCard, headlineOverlay, introCard, logoPng, outroCard } from "./reel-cards.js";
import {
  ambientMusicArgs,
  approxWordTimings,
  buildFinalArgs,
  buildReelAss,
  buildSegmentArgs,
  buildTimeline,
  importantWordFlags,
  logoPosition,
  sfxSynthArgs,
  whooshTimes,
} from "./reel-logic.js";

/** Real ffmpeg + canvas run of a Reel Studio render (no network, no DB). Skipped when ffmpeg/ffprobe aren't installed. */
const haveTools = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const FONTS = fileURLToPath(new URL("../../../assets/fonts", import.meta.url));

describe.skipIf(!haveTools)("reel render with real ffmpeg", () => {
  let dir = "";
  const size = { w: 1080, h: 1920 };
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reel-render-"));
    const gen = (args: string[]) => ffmpeg(["-y", "-loglevel", "error", ...args], { cwd: dir });
    await gen(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=25:duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "land.mp4"]);
    await gen(["-f", "lavfi", "-i", "testsrc2=size=800x800:rate=1:duration=1", "-frames:v", "1", "square.png"]);
    await gen(["-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*200*t):s=44100:d=2.2", "-c:a", "libmp3lame", "v0.mp3"]);
    await gen(["-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*260*t):s=44100:d=2.6", "-c:a", "libmp3lame", "v1.mp3"]);
    await gen(["-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t):s=44100:d=4", "-c:a", "libmp3lame", "music.mp3"]);
    await mkdir(path.join(dir, "fonts"));
    for (const f of await readdir(FONTS)) if (f.endsWith(".ttf")) await copyFile(path.join(FONTS, f), path.join(dir, "fonts", f));
  }, 60_000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("intro + photo + footage + graphic + outro -> one 1080x1920 MP4 with audio", async () => {
    const { readFile } = await import("node:fs/promises");
    const logo = await readFile(path.join(dir, "square.png"));
    const theme = await cardTheme({ colors: ["#7C3AED", "#DB2777"], headingFontUrl: null, bodyFontUrl: null, logo, brandName: "Test Brand", seed: "x" });
    await introCard("Five facts about honey", theme, size, path.join(dir, "intro.png"));
    await outroCard("Shop now", "Pure. Raw. Local.", theme, size, path.join(dir, "outro.png"));
    await graphicCard("Bees visit 2 million flowers", "", theme, size, path.join(dir, "g.png"));
    await headlineOverlay("Honey never spoils", theme, size, path.join(dir, "h.png"));
    await logoPng(logo, path.join(dir, "logo.png"));

    const segs = [
      { kind: "image" as const, file: "intro.png", lengthSec: 1.6, fit: false, overlay: null, motion: 1 },
      { kind: "image" as const, file: "square.png", lengthSec: 3, fit: true, overlay: "h.png", motion: 2 },
      { kind: "video" as const, file: "land.mp4", lengthSec: 3.4, fit: false, overlay: "h.png", motion: 0 },
      { kind: "image" as const, file: "g.png", lengthSec: 2.5, fit: false, overlay: null, motion: 3 },
      { kind: "image" as const, file: "outro.png", lengthSec: 2.6, fit: false, overlay: null, motion: 0 },
    ];
    const files: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const out = `seg-${i}.mp4`;
      const r = await ffmpeg(buildSegmentArgs({ ...segs[i]!, size, zoom: 0.1, out }), { cwd: dir });
      expect(r.code, r.stderr).toBe(0);
      files.push(out);
    }
    const timeline = buildTimeline(segs.map((s) => s.lengthSec), 0.45);
    const words = [
      ...approxWordTimings("Honey never spoils at all", 2.2).map((w) => ({ ...w, start: w.start + timeline.starts[1]! + 0.3, end: w.end + timeline.starts[1]! + 0.3 })),
      ...approxWordTimings("Archaeologists found edible honey", 2.6).map((w) => ({ ...w, start: w.start + timeline.starts[2]! + 0.3, end: w.end + timeline.starts[2]! + 0.3 })),
    ];
    const { ass } = buildReelAss(words, { preset: "bold", position: "bottom", size: 1, textColor: "#FFFFFF", highlightColor: "#FFD400", font: "Noto Sans" }, size);
    await writeFile(path.join(dir, "captions.ass"), ass);
    const pos = logoPosition("top-right", 48);
    const r = await ffmpeg(
      buildFinalArgs({
        segments: files,
        timeline,
        transition: "slideleft",
        voices: [
          { file: "v0.mp3", atSec: timeline.starts[1]! + 0.3 },
          { file: "v1.mp3", atSec: timeline.starts[2]! + 0.3 },
        ],
        voiceVolume: 1,
        musicFile: "music.mp3",
        musicVolume: 0.3,
        logo: { file: "logo.png", ...pos, widthPx: 160, fromSec: timeline.starts[1]!, toSec: timeline.starts[4]! },
        assFile: "captions.ass",
        fontsDir: "fonts",
        size,
        out: "reel.mp4",
      }),
      { cwd: dir },
    );
    expect(r.code, r.stderr).toBe(0);
    const probe = await probeOutput(path.join(dir, "reel.mp4"));
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.audioCodec).toBe("aac");
    expect(probe.durationSec).toBeGreaterThan(timeline.total - 0.2);
    expect(probe.durationSec).toBeLessThan(timeline.total + 0.2);
    expect(probe.meanVolumeDb).toBeGreaterThan(-40);
  }, 240_000);

  it("tilt motions + synthesised music, whooshes and hits + emphasised neon/boxed subtitles", async () => {
    const synth: [string[], string][] = [
      [sfxSynthArgs("whoosh", "whoosh.wav"), "whoosh"],
      [sfxSynthArgs("hit", "hit.wav"), "hit"],
      [ambientMusicArgs("upbeat-pulse", 12, "bed.wav"), "music"],
    ];
    for (const [args, name] of synth) {
      const r = await ffmpeg(args, { cwd: dir });
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
    }
    const segs = [
      { kind: "image" as const, file: "square.png", lengthSec: 2.4, fit: false, overlay: null, motion: 4 },
      { kind: "image" as const, file: "square.png", lengthSec: 2.4, fit: true, overlay: null, motion: 5 },
      { kind: "video" as const, file: "land.mp4", lengthSec: 2.4, fit: false, overlay: null, motion: 0 },
    ];
    const files: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const out = `t-${i}.mp4`;
      const r = await ffmpeg(buildSegmentArgs({ ...segs[i]!, size, zoom: 0.12, out }), { cwd: dir });
      expect(r.code, r.stderr).toBe(0);
      files.push(out);
    }
    const timeline = buildTimeline(segs.map((s) => s.lengthSec), 0.4);
    for (const preset of ["neon", "boxed"] as const) {
      const raw = approxWordTimings("Save 40% on HONEY this weekend only!", 4);
      const flags = importantWordFlags(raw.map((w) => w.word), "Honey weekend");
      const words = raw.map((w, i) => ({ ...w, start: w.start + 0.3, end: w.end + 0.3, em: flags[i] }));
      const { ass } = buildReelAss(words, { preset, position: "bottom", size: 1, textColor: "#FFFFFF", highlightColor: "#22D3EE", font: "Noto Sans" }, size);
      await writeFile(path.join(dir, `c-${preset}.ass`), ass);
      const out = `fx-${preset}.mp4`;
      const r = await ffmpeg(
        buildFinalArgs({
          segments: files,
          timeline,
          transition: "fade",
          voices: [],
          voiceVolume: 1,
          musicFile: "bed.wav",
          musicVolume: 0.3,
          logo: null,
          assFile: `c-${preset}.ass`,
          fontsDir: "fonts",
          size,
          out,
          sfx: { whoosh: "whoosh.wav", hit: "hit.wav", whooshAt: whooshTimes(timeline), hitAt: [0], volume: 0.5 },
        }),
        { cwd: dir },
      );
      expect(r.code, r.stderr).toBe(0);
      const probe = await probeOutput(path.join(dir, out));
      expect(probe.width).toBe(1080);
      expect(probe.audioCodec).toBe("aac");
      expect(probe.meanVolumeDb).toBeGreaterThan(-40);
      expect(Math.abs((probe.durationSec ?? 0) - timeline.total)).toBeLessThan(0.2);
    }
  }, 240_000);
});
