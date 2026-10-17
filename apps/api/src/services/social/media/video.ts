import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SocialPublishError } from "../errors.js";
import { ffmpegPath } from "./youtube-video.js";

const FFMPEG_TIMEOUT_MS = 10 * 60_000;

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  /** True when the container is MP4/MOV (an `ftyp` box at the start). */
  isIsoBmff: boolean;
}

/** ISO-BMFF files (mp4/mov) start with a size field then the `ftyp` box. */
export const looksLikeMp4 = (buf: Buffer): boolean =>
  buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp";

/** Parses what `ffmpeg -i` prints (ffprobe isn't bundled): Duration, codecs, frame size. */
export function parseFfmpegInfo(stderr: string): Omit<VideoInfo, "isIsoBmff"> | null {
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const video = /Stream #[^\n]*Video:\s*([a-z0-9_]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/i.exec(stderr);
  if (!dur || !video) return null;
  const audio = /Stream #[^\n]*Audio:\s*([a-z0-9_]+)/i.exec(stderr);
  let width = Number(video[2]);
  let height = Number(video[3]);
  // Phone footage is often stored landscape with a rotate flag; swap so 9:16 reads as 9:16.
  const rot = /rotate\s*:\s*(-?\d+)/i.exec(stderr) ?? /displaymatrix: rotation of (-?[\d.]+) degrees/i.exec(stderr);
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width];
  return {
    durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    width,
    height,
    videoCodec: video[1]!.toLowerCase(),
    audioCodec: audio ? audio[1]!.toLowerCase() : null,
  };
}

function run(bin: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    proc.on("error", () => {
      clearTimeout(timer);
      reject(new SocialPublishError("INVALID_MEDIA", "ffmpeg could not be started"));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "catgpt-vid-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeVideo(buffer: Buffer): Promise<VideoInfo> {
  const bin = await ffmpegPath();
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.bin");
    await writeFile(input, buffer);
    // No output file: ffmpeg prints the stream info then exits non-zero, which is fine.
    const { stderr } = await run(bin, ["-hide_banner", "-i", input]);
    const info = parseFfmpegInfo(stderr);
    if (!info) throw new SocialPublishError("INVALID_MEDIA", "This file isn't a readable video");
    return { ...info, isIsoBmff: looksLikeMp4(buffer) };
  });
}

/** Already in the shape Instagram/Facebook/YouTube accept: MP4 + H.264 (+ AAC or silent). */
export const isPlatformReady = (i: VideoInfo): boolean =>
  i.isIsoBmff && i.videoCodec === "h264" && (i.audioCodec === null || i.audioCodec === "aac");

/**
 * Re-encodes to H.264/AAC MP4 with the moov atom up front (iPhone HEVC .mov and
 * odd codecs are rejected by Instagram). Only called when probeVideo says the
 * file isn't already platform-ready.
 */
export async function transcodeToMp4(buffer: Buffer): Promise<Buffer> {
  const bin = await ffmpegPath();
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.bin");
    const output = path.join(dir, "out.mp4");
    await writeFile(input, buffer);
    const { code, stderr } = await run(bin, [
      "-y", "-i", input,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-movflags", "+faststart",
      output,
    ]);
    if (code !== 0) {
      console.error(`[video] ffmpeg transcode exited ${code}: ${stderr.trim().split("\n").pop()}`);
      throw new SocialPublishError("INVALID_MEDIA", "Could not convert this video to MP4");
    }
    return readFile(output);
  });
}
