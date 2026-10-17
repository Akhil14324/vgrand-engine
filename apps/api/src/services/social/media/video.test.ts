import { describe, expect, it } from "vitest";
import { isPlatformReady, looksLikeMp4, parseFfmpegInfo } from "./video.js";

const SAMPLE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'in.bin':
  Duration: 00:00:12.48, start: 0.000000, bitrate: 4021 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], 3900 kb/s, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s`;

describe("parseFfmpegInfo", () => {
  it("reads duration, size and codecs", () => {
    const info = parseFfmpegInfo(SAMPLE)!;
    expect(info.durationSec).toBeCloseTo(12.48);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
  });

  it("treats a silent clip as audio-less and swaps rotated dimensions", () => {
    const info = parseFfmpegInfo(
      `Duration: 00:01:05.00, start: 0\n  Stream #0:0: Video: hevc (Main), yuv420p, 1920x1080, 30 fps\n    displaymatrix: rotation of -90.00 degrees`,
    )!;
    expect(info.audioCodec).toBeNull();
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.durationSec).toBe(65);
  });

  it("returns null for non-video output", () => {
    expect(parseFfmpegInfo("Invalid data found when processing input")).toBeNull();
  });
});

describe("platform readiness", () => {
  const base = { durationSec: 10, width: 1080, height: 1920, isIsoBmff: true };
  it("accepts h264 + aac mp4 and silent h264", () => {
    expect(isPlatformReady({ ...base, videoCodec: "h264", audioCodec: "aac" })).toBe(true);
    expect(isPlatformReady({ ...base, videoCodec: "h264", audioCodec: null })).toBe(true);
  });
  it("rejects hevc, odd audio and non-mp4 containers", () => {
    expect(isPlatformReady({ ...base, videoCodec: "hevc", audioCodec: "aac" })).toBe(false);
    expect(isPlatformReady({ ...base, videoCodec: "h264", audioCodec: "mp3" })).toBe(false);
    expect(isPlatformReady({ ...base, isIsoBmff: false, videoCodec: "h264", audioCodec: "aac" })).toBe(false);
  });
});

describe("looksLikeMp4", () => {
  it("detects the ftyp box", () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
    expect(looksLikeMp4(mp4)).toBe(true);
    expect(looksLikeMp4(Buffer.alloc(32))).toBe(false);
  });
});
