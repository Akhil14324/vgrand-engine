import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { FFMPEG_BIN, FFPROBE_BIN } from "./env-check.js";
import { parseFfprobe, parseMeanVolume, type ProbeResult } from "./validate-logic.js";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a process with a timeout; keeps the tail of stderr for error messages. */
export function runProc(bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => {
      stdout = (stdout + d.toString()).slice(-200_000);
    });
    p.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    const t = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 15 * 60_000);
    p.on("error", (err) => {
      clearTimeout(t);
      reject(new Error(`${bin} could not be started: ${err.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

export const ffmpeg = (args: string[], opts?: { cwd?: string; timeoutMs?: number }) => runProc(FFMPEG_BIN, args, opts);

/** Duration in seconds of any media file, via ffprobe. */
export async function mediaDuration(file: string): Promise<number> {
  const r = await runProc(FFPROBE_BIN, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = Number(r.stdout.trim());
  if (r.code !== 0 || !Number.isFinite(d)) throw new Error(`ffprobe could not read ${file}: ${r.stderr.slice(-300)}`);
  return d;
}

/** Width/height/duration of a video file. */
export async function videoInfo(file: string): Promise<{ width: number; height: number; durationSec: number; hasAudio: boolean }> {
  const r = await runProc(FFPROBE_BIN, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  if (r.code !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.slice(-300)}`);
  const p = parseFfprobe(JSON.parse(r.stdout), 0);
  if (!p.width || !p.height || !p.durationSec) throw new Error(`${file} has no readable video stream`);
  return { width: p.width, height: p.height, durationSec: p.durationSec, hasAudio: p.audioCodec !== null };
}

/** Everything validateOutput needs: stream info, size, and mean loudness of the audio. */
export async function probeOutput(file: string): Promise<ProbeResult> {
  const { size } = await stat(file);
  const r = await runProc(FFPROBE_BIN, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.slice(-500)}`);
  const base = parseFfprobe(JSON.parse(r.stdout), size);
  let meanVolumeDb: number | null = null;
  if (base.audioCodec) {
    const v = await ffmpeg(["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
    meanVolumeDb = parseMeanVolume(v.stderr);
  }
  return { ...base, meanVolumeDb };
}
