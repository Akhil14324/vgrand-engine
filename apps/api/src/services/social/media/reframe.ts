import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { storeImage } from "../../storage.js";
import { fetchImage } from "./fetch-image.js";
import { ffmpegPath } from "./youtube-video.js";

/** Instagram feed accepts aspect ratios (width / height) from 4:5 up to 1.91:1. */
const IG_MIN_RATIO = 0.8;
const IG_MAX_RATIO = 1.91;
const FFMPEG_TIMEOUT_MS = 60_000;

const run = (bin: string, args: string[]) =>
  new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

/** Pixel size read from ffmpeg's stream banner (`ffmpeg -i` exits non-zero but still prints it). */
export function parseDimensions(banner: string): { width: number; height: number } | null {
  const m = /Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(banner);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** What canvas an image needs for Instagram's feed, or null when it already fits. */
export function instagramCanvas(width: number, height: number): { w: number; h: number } | null {
  const ratio = width / height;
  if (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO) return null;
  return ratio < IG_MIN_RATIO ? { w: 1080, h: 1350 } : { w: 1080, h: 1080 };
}

/**
 * Instagram rejects feed images outside 4:5 - 1.91:1, and our default 2:3 size
 * is one of them. Fits the whole image onto a valid canvas over a blurred copy
 * of itself (nothing is cropped away). Returns the new stored URL, or null when
 * the image already fits or the conversion isn't possible - callers then post
 * the original.
 */
export async function fitImageForInstagram(url: string, userId: string): Promise<string | null> {
  try {
    const { buffer } = await fetchImage(url);
    const bin = await ffmpegPath();
    const dir = await mkdtemp(path.join(tmpdir(), "catgpt-fit-"));
    try {
      const input = path.join(dir, "in.img");
      const output = path.join(dir, "out.jpg");
      await writeFile(input, buffer);

      const probe = await run(bin, ["-hide_banner", "-i", input]);
      const dims = parseDimensions(probe.stderr);
      const canvas = dims && instagramCanvas(dims.width, dims.height);
      if (!canvas) return null;

      const { w, h } = canvas;
      const filter =
        `split[a][b];` +
        `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=30:5[bg];` +
        `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuvj420p`;
      const res = await run(bin, ["-y", "-i", input, "-vf", filter, "-frames:v", "1", "-q:v", "2", output]);
      if (res.code !== 0) throw new Error(res.stderr.trim().split("\n").pop());

      return await storeImage({
        buffer: await readFile(output),
        mimeType: "image/jpeg",
        keyPrefix: `social-fit/${userId}`,
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    console.error("[social] instagram reframe skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}
