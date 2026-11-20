import { describe, expect, it } from "vitest";
import { beatSpans, buildAss, evenWordTimings, groupWords, wordsFromAlignment } from "./captions-logic.js";
import { buildComposeArgs, clipStart, targetDuration } from "./compose-logic.js";
import { buildDims, hourIn, lengthBucket } from "./dims-logic.js";
import { pathBViolations } from "./rules-logic.js";
import {
  buildScriptPrompt,
  cleanTags,
  narrationOf,
  scriptHash,
  scriptOutputSchema,
  scriptProblems,
  type ScriptOutput,
} from "./script-logic.js";
import { footageHash, isAllowedStockUrl, isUsable, parsePexels, parsePixabay, pickClips, type StockCandidate } from "./stock-logic.js";
import { parseFfprobe, parseMeanVolume, validateOutput, type ProbeResult } from "./validate-logic.js";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const goodScript = (): ScriptOutput => ({
  topic: "cat slow blinks",
  hookType: "shock_fact",
  hook: "Your cat is saying I love you.",
  beats: [
    { narration: `When a cat slowly blinks at you ${words(20)}`, searchQueries: ["cat blinking"] },
    { narration: `Researchers found that ${words(25)}`, searchQueries: ["cat face close up"] },
  ],
  title: "Why your cat slow blinks at you",
  description: "The slow blink is a cat's way of showing trust.",
  tags: ["cats", "#catfacts", "Cats", "kitten"],
});

describe("script", () => {
  it("prompt carries style notes, banned topics and the last titles", () => {
    const p = buildScriptPrompt({
      channelName: "Cats",
      niche: "cats",
      styleNotes: { tone: "warm", hookPatterns: ["POV"], bannedTopics: ["politics"] },
      recentTitles: ["Old title one", "Old title two"],
      avoidNote: "pick something else",
    });
    expect(p.system).toContain("warm");
    expect(p.system).toContain("politics");
    expect(p.user).toContain("- Old title one");
    expect(p.user).toContain("pick something else");
    expect(p.user).toMatch(/39-104 words/);
  });

  it("accepts a valid script and enforces title, hook, length and banned topics", () => {
    const s = goodScript();
    expect(scriptOutputSchema.parse(s)).toBeTruthy();
    expect(scriptProblems(s, ["politics"])).toEqual([]);
    expect(scriptProblems({ ...s, title: "x".repeat(70) })[0]).toMatch(/title is 70/);
    expect(scriptProblems({ ...s, hook: words(9) })[0]).toMatch(/hook is 9 words/);
    expect(scriptProblems({ ...s, beats: [{ narration: "short", searchQueries: ["a cat"] }, { narration: "too", searchQueries: ["b"] }] })[0]).toMatch(/min 15s/);
    expect(scriptProblems({ ...s, beats: [{ narration: words(120), searchQueries: ["a"] }, { narration: "x", searchQueries: ["b"] }] })[0]).toMatch(/max 40s/);
    expect(scriptProblems({ ...s, title: "Cats and politics" }, ["politics"])).toEqual(['mentions banned topic "politics"']);
  });

  it("hashes narration ignoring case, punctuation and spacing", () => {
    expect(scriptHash("Hello,  World!")).toBe(scriptHash("hello world"));
    expect(scriptHash("hello world")).not.toBe(scriptHash("hello there world"));
    expect(narrationOf(goodScript()).startsWith("Your cat is saying I love you. When a cat")).toBe(true);
  });

  it("cleans tags: no '#', no duplicates", () => {
    expect(cleanTags(["cats", "#catfacts", "Cats", "kitten"])).toEqual(["cats", "catfacts", "kitten"]);
  });
});

describe("stock", () => {
  it("only allows https Pexels/Pixabay hosts and never social platforms", () => {
    expect(isAllowedStockUrl("https://videos.pexels.com/video-files/1/a.mp4")).toBe(true);
    expect(isAllowedStockUrl("https://cdn.pixabay.com/video/2020/a.mp4")).toBe(true);
    expect(isAllowedStockUrl("http://videos.pexels.com/a.mp4")).toBe(false);
    expect(isAllowedStockUrl("https://www.youtube.com/watch?v=x")).toBe(false);
    expect(isAllowedStockUrl("https://v16.tiktokcdn.com/a.mp4")).toBe(false);
    expect(isAllowedStockUrl("https://example.com/a.mp4")).toBe(false);
  });

  it("parses Pexels: picks the smallest MP4 rendition that is at least 1080 on the short side", () => {
    const c = parsePexels({
      videos: [
        {
          id: 7,
          url: "https://www.pexels.com/video/7/",
          duration: 12,
          user: { name: "Ann", url: "https://www.pexels.com/@ann" },
          video_files: [
            { quality: "sd", file_type: "video/mp4", width: 540, height: 960, link: "https://videos.pexels.com/sd.mp4" },
            { quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/hd.mp4" },
            { quality: "uhd", file_type: "video/mp4", width: 2160, height: 3840, link: "https://videos.pexels.com/uhd.mp4" },
          ],
        },
      ],
    });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ provider: "pexels", id: "7", downloadUrl: "https://videos.pexels.com/hd.mp4", license: "Pexels License", author: "Ann" });
  });

  it("parses Pixabay and skips an empty `large` rendition", () => {
    const c = parsePixabay({
      hits: [
        {
          id: 9,
          pageURL: "https://pixabay.com/videos/id-9/",
          duration: 20,
          user: "bob",
          user_id: 3,
          videos: {
            large: { url: "", width: 0, height: 0, size: 0 },
            medium: { url: "https://cdn.pixabay.com/video/9/m.mp4", width: 1080, height: 1920, size: 5 },
          },
        },
      ],
    });
    expect(c[0]).toMatchObject({ provider: "pixabay", downloadUrl: "https://cdn.pixabay.com/video/9/m.mp4", license: "Pixabay Content License" });
  });

  const cand = (id: string, w: number, h: number, d = 10): StockCandidate => ({
    provider: "pexels",
    id,
    pageUrl: `https://www.pexels.com/video/${id}/`,
    downloadUrl: `https://videos.pexels.com/${id}.mp4`,
    width: w,
    height: h,
    durationSec: d,
    author: null,
    authorUrl: null,
    license: "Pexels License",
    licenseUrl: "https://www.pexels.com/license/",
  });

  it("keeps vertical or croppable clips only", () => {
    expect(isUsable(cand("a", 1080, 1920))).toBe(true);
    expect(isUsable(cand("b", 1920, 1080))).toBe(true); // 607px center crop
    expect(isUsable(cand("c", 1280, 720))).toBe(false); // crop only 405px wide
    expect(isUsable(cand("d", 1080, 1920, 1))).toBe(false); // too short
  });

  it("prefers vertical, never repeats a clip in one video, avoids clips used in the last 30 days", () => {
    const shared = [cand("v1", 1080, 1920), cand("h1", 1920, 1080)];
    const picks = pickClips(
      [
        { index: 0, neededSec: 5, candidates: shared },
        { index: 1, neededSec: 5, candidates: shared },
      ],
      new Set(),
    );
    expect(picks.map((p) => p?.clip.id)).toEqual(["v1", "h1"]);
    const avoid = pickClips([{ index: 0, neededSec: 5, candidates: shared }], new Set(["pexels:v1"]));
    expect(avoid[0]?.clip.id).toBe("h1");
    expect(pickClips([{ index: 0, neededSec: 5, candidates: [cand("x", 640, 360)] }], new Set())[0]).toBeNull();
  });

  it("footage hash is order independent", () => {
    expect(footageHash(["a", "b"])).toBe(footageHash(["b", "a"]));
  });
});

describe("captions", () => {
  it("builds words from ElevenLabs character alignment", () => {
    const text = "Hi cat.";
    const w = wordsFromAlignment({
      characters: text.split(""),
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    });
    expect(w).toEqual([
      { word: "Hi", start: 0, end: 0.2 },
      { word: "cat.", start: 0.3, end: 0.7 },
    ]);
  });

  it("splits beats by word count and merges the hook into the first clip", () => {
    const wt = evenWordTimings("a b c d e f g h", 8);
    const spans = beatSpans("a b", ["c d e", "f g h"], wt, 9);
    expect(spans).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 9 },
    ]);
  });

  it("groups up to 3 words and breaks after punctuation", () => {
    const g = groupWords(evenWordTimings("one two three four. five", 5));
    expect(g.map((x) => x.words.map((w) => w.word).join(" "))).toEqual(["one two three", "four.", "five"]);
  });

  it("emits one highlighted event per word and strips ASS override characters", () => {
    const { ass, events } = buildAss(evenWordTimings("hello {bad} world", 3));
    expect(events).toBe(3);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).not.toContain("{BAD}");
    expect(ass).toMatch(/Dialogue: 0,0:00:00\.00,0:00:01\.00,Caption,,0,0,0,,\{\\c&H0000E5FF&\}HELLO/);
  });
});

describe("compose", () => {
  it("clamps duration to the Shorts window and refuses an over-long voice", () => {
    expect(targetDuration(10)).toBe(15);
    expect(targetDuration(30)).toBeCloseTo(30.6);
    expect(targetDuration(44.9)).toBeNull();
    expect(clipStart(20, 5)).toBe(1);
    expect(clipStart(5, 5)).toBe(0);
  });

  it("crops to 1080x1920, burns captions, ducks music under the voice", () => {
    const args = buildComposeArgs({
      clips: [
        { path: "a.mp4", startSec: 1, lengthSec: 5, loop: false },
        { path: "b.mp4", startSec: 0, lengthSec: 10, loop: true },
      ],
      voicePath: "v.mp3",
      musicPath: "m.mp3",
      assFile: "captions.ass",
      fontsDir: "fonts",
      totalSec: 15,
      outFile: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("crop=1080:1920");
    expect(fc).toContain("concat=n=2");
    expect(fc).toContain("subtitles=filename=captions.ass:fontsdir=fonts");
    expect(fc).toContain("sidechaincompress");
    expect(args.slice(args.indexOf("b.mp4") - 3, args.indexOf("b.mp4"))).toEqual(["-stream_loop", "-1", "-i"]);
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
  });

  it("without music, maps only the voice", () => {
    const args = buildComposeArgs({
      clips: [{ path: "a.mp4", startSec: 0, lengthSec: 15, loop: false }],
      voicePath: "v.mp3",
      musicPath: null,
      assFile: "c.ass",
      fontsDir: "f",
      totalSec: 15,
      outFile: "o.mp4",
    });
    expect(args.join(" ")).not.toContain("sidechaincompress");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
  });
});

describe("validation", () => {
  const good: ProbeResult = { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", durationSec: 30, sizeBytes: 5_000_000, meanVolumeDb: -20 };
  it("passes a correct file", () => {
    expect(validateOutput(good, { captionEvents: 40, requireCaptions: true }).ok).toBe(true);
  });
  it("fails loudly on each spec check", () => {
    const fails = (p: Partial<typeof good>, captionEvents = 40) =>
      validateOutput({ ...good, ...p }, { captionEvents, requireCaptions: true }).checks.filter((c) => !c.ok).map((c) => c.name);
    expect(fails({ width: 720 })).toEqual(["resolution"]);
    expect(fails({ durationSec: 50 })).toEqual(["duration"]);
    expect(fails({ audioCodec: null })).toEqual(["audio_present"]);
    expect(fails({ meanVolumeDb: -91 })).toEqual(["audio_present"]);
    expect(fails({}, 0)).toEqual(["captions_present"]);
    expect(fails({ sizeBytes: 1000 })).toEqual(["file_size"]);
  });
  it("parses ffprobe JSON and volumedetect output", () => {
    const p = parseFfprobe(
      { streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "31.5" } },
      123,
    );
    expect(p).toEqual({ width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", durationSec: 31.5, sizeBytes: 123 });
    expect(parseMeanVolume("[Parsed_volumedetect_0 @ 0x] mean_volume: -21.3 dB")).toBe(-21.3);
    expect(parseMeanVolume("mean_volume: -inf dB")).toBe(-91);
  });
});

describe("content rules", () => {
  const stock = { kind: "stock_video", provider: "pexels", sourceUrl: "https://www.pexels.com/video/1/", license: "Pexels License", localPath: "/x" };
  const voice = { kind: "voiceover", provider: "elevenlabs", sourceUrl: null, license: "x", localPath: "/v.mp3" };
  it("rejects stock footage plus music without an original script and voiceover", () => {
    const v = pathBViolations({ narration: "", assets: [stock, { kind: "music", provider: "music_library", sourceUrl: null, license: "x", localPath: "/m" }], dryRun: false });
    expect(v.join("\n")).toMatch(/no original script/);
    expect(v.join("\n")).toMatch(/no voiceover/);
  });
  it("rejects footage from anywhere but Pexels/Pixabay, or without a license record", () => {
    expect(pathBViolations({ narration: words(30), assets: [voice, { ...stock, provider: "youtube" }], dryRun: false }).join()).toMatch(/not allowed/);
    expect(pathBViolations({ narration: words(30), assets: [voice, { ...stock, license: "" }], dryRun: false }).join()).toMatch(/license/);
    expect(pathBViolations({ narration: words(30), assets: [voice, { ...stock, provider: "offline_fixture" }], dryRun: false })).toHaveLength(1);
    expect(pathBViolations({ narration: words(30), assets: [voice, { ...stock, provider: "offline_fixture" }], dryRun: true })).toEqual([]);
  });
  it("music only from the music library", () => {
    expect(pathBViolations({ narration: words(30), assets: [voice, stock, { kind: "music", provider: "freesound", sourceUrl: null, license: "x", localPath: "/m" }], dryRun: false }).join()).toMatch(/music_library/);
  });
});

describe("experiment dimensions", () => {
  it("buckets length and reads the posting hour in IST", () => {
    expect(lengthBucket(20)).toBe("15-24s");
    expect(lengthBucket(36.4)).toBe("35-45s");
    expect(hourIn(new Date("2026-11-20T03:00:00Z"), "Asia/Kolkata")).toBe(8);
    const d = buildDims({ slug: "cats", niche: "cats" }, { path: "B", hookType: "pov", durationSec: 30, voiceId: "v", topic: "t", slotAt: new Date("2026-11-20T13:00:00Z"), synthetic: false }, "Asia/Kolkata");
    expect(d).toEqual({ channel: "cats", niche: "cats", path: "B", hookType: "pov", lengthBucket: "25-34s", voice: "v", topic: "t", postingHour: 18, synthetic: false });
  });
});
