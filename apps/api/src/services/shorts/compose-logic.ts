/**
 * ffmpeg command for a Short: N clips cropped to 1080x1920 and concatenated,
 * word-synced captions burned in, voiceover, and optional music ducked under it.
 */

export const OUT_W = 1080;
export const OUT_H = 1920;
export const FPS = 30;
export const MIN_SHORT_SEC = 15;
export const MAX_SHORT_SEC = 45;
/** Silence after the last word before the video ends. */
export const TAIL_SEC = 0.6;

export interface ComposeClip {
  path: string;
  /** Second of the source where this clip starts. */
  startSec: number;
  lengthSec: number;
  /** Source shorter than lengthSec: loop it. */
  loop: boolean;
}

export interface ComposeInput {
  clips: ComposeClip[];
  voicePath: string;
  musicPath: string | null;
  /** ASS file name, relative to the working directory ffmpeg runs in. */
  assFile: string;
  /** Directory holding the caption font, relative to the working directory. */
  fontsDir: string;
  totalSec: number;
  outFile: string;
}

/** Final length: voice + tail, clamped to the Shorts window. Null when the voice can't fit. */
export function targetDuration(voiceSec: number): number | null {
  const t = voiceSec + TAIL_SEC;
  if (voiceSec > MAX_SHORT_SEC - 0.2) return null;
  return Math.min(MAX_SHORT_SEC, Math.max(MIN_SHORT_SEC, +t.toFixed(3)));
}

/** Source start offset: skip the first second of long clips (often a fade-in), start at 0 otherwise. */
export function clipStart(sourceSec: number, lengthSec: number): number {
  return sourceSec >= lengthSec + 2 ? 1 : 0;
}

const n3 = (x: number) => x.toFixed(3);

export function buildComposeArgs(input: ComposeInput): string[] {
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  input.clips.forEach((c) => {
    if (c.loop) args.push("-stream_loop", "-1");
    args.push("-i", c.path);
  });
  const voiceIdx = input.clips.length;
  args.push("-i", input.voicePath);
  let musicIdx = -1;
  if (input.musicPath) {
    musicIdx = voiceIdx + 1;
    args.push("-stream_loop", "-1", "-i", input.musicPath);
  }

  const f: string[] = [];
  input.clips.forEach((c, i) => {
    f.push(
      `[${i}:v]trim=start=${n3(c.startSec)}:duration=${n3(c.lengthSec)},setpts=PTS-STARTPTS,` +
        `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},` +
        `setsar=1,fps=${FPS},format=yuv420p[v${i}]`,
    );
  });
  f.push(`${input.clips.map((_, i) => `[v${i}]`).join("")}concat=n=${input.clips.length}:v=1:a=0[vcat]`);
  f.push(`[vcat]subtitles=filename=${input.assFile}:fontsdir=${input.fontsDir}[vout]`);

  const voiceChain = `[${voiceIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad`;
  if (musicIdx >= 0) {
    f.push(`${voiceChain},asplit=2[vo1][vo2]`);
    f.push(`[${musicIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.35[mus]`);
    // Duck music whenever the voice is present.
    f.push(`[mus][vo1]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[ducked]`);
    f.push(`[vo2][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  } else {
    f.push(`${voiceChain},loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  }

  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    "-t", n3(input.totalSec),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    input.outFile,
  );
  return args;
}
