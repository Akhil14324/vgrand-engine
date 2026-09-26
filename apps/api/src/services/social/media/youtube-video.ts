import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SocialPublishError } from "../errors.js";

const DURATION_SECONDS = 8;
const WIDTH = 1080;
const HEIGHT = 1920;
const FFMPEG_TIMEOUT_MS = 120_000;

/** The project's ffmpeg: the `ffmpeg-static` package's bundled binary. */
export async function ffmpegPath(): Promise<string> {
  try {
    const mod = (await import("ffmpeg-static")) as { default?: string | null };
    if (mod.default) return mod.default;
  } catch {
    // fall through
  }
  throw new SocialPublishError(
    "INVALID_MEDIA",
    "ffmpeg is unavailable on this server, so the image cannot be converted to a video for YouTube",
  );
}

/**
 * Turns a still image into an ~8s 1080x1920 H.264 MP4 (image centred on a black
 * canvas, no audio) - YouTube only accepts video. The result is returned as a
 * Buffer; temp files are always removed.
 */
export async function imageToYoutubeVideo(image: Buffer): Promise<Buffer> {
  const bin = await ffmpegPath();
  const dir = await mkdtemp(path.join(tmpdir(), "catgpt-yt-"));
  const input = path.join(dir, "in.img");
  const output = path.join(dir, "out.mp4");
  try {
    await writeFile(input, image);
    const filter =
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p`;
    const args = [
      "-y",
      "-loop", "1",
      "-i", input,
      "-t", String(DURATION_SECONDS),
      "-vf", filter,
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      output,
    ];
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      const timer = setTimeout(() => proc.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
      proc.on("error", () => {
        clearTimeout(timer);
        reject(new SocialPublishError("INVALID_MEDIA", "ffmpeg could not be started"));
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        console.error(`[social] ffmpeg exited ${code}: ${stderr.trim().split("\n").pop()}`);
        reject(new SocialPublishError("INVALID_MEDIA", "Could not convert the image to a video"));
      });
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
