import type { ReelScript, VideoResolution } from "@catgpt/types";

/**
 * Pure render planning (phase 3): turns a footage-only shot list into timed
 * segments and one ffmpeg command. No I/O here, so the rules are testable.
 */

export const RENDER_SIZES: Record<string, Record<VideoResolution, { w: number; h: number }>> = {
  "9:16": { "720p": { w: 720, h: 1280 }, "1080p": { w: 1080, h: 1920 } },
  "1:1": { "720p": { w: 720, h: 720 }, "1080p": { w: 1080, h: 1080 } },
  "16:9": { "720p": { w: 1280, h: 720 }, "1080p": { w: 1920, h: 1080 } },
};

export const RENDER_FPS = 30;

/** What the planner knows about a file in the source folder. */
export interface SourceInfo {
  fileName: string;
  kind: "image" | "video";
  /** Seconds, for videos. Null for images. */
  durationSec: number | null;
}

export interface PlannedSegment {
  shotId: string;
  fileName: string;
  kind: "image" | "video";
  /** Where in the source file this shot starts. Images always start at 0. */
  sourceStartSec: number;
  lengthSec: number;
}

export type SegmentPlan =
  | { ok: true; segments: PlannedSegment[] }
  | { ok: false; problems: string[] };

/**
 * Plans footage shots in order. Shots that use the same video continue where
 * the previous shot stopped, so the reel doesn't replay the same seconds. If
 * the file runs out, the shot starts again from the beginning.
 */
export function planFootageSegments(script: ReelScript, sources: SourceInfo[]): SegmentPlan {
  const problems: string[] = [];
  const segments: PlannedSegment[] = [];
  const cursor = new Map<string, number>();
  const byName = new Map(sources.map((s) => [s.fileName, s]));

  const shots = [...script.shots].sort((a, b) => a.startSec - b.startSec);
  for (const shot of shots) {
    if (shot.kind !== "footage") {
      problems.push(
        `Shot ${shot.id} is a ${shot.kind.replace("_", " ")} shot. Only footage shots can be rendered for now.`,
      );
      continue;
    }
    if (!shot.sourceFile) {
      problems.push(`Shot ${shot.id} has no source file.`);
      continue;
    }
    const source = byName.get(shot.sourceFile);
    if (!source) {
      problems.push(`Shot ${shot.id} uses "${shot.sourceFile}", which is not in the folder.`);
      continue;
    }
    const lengthSec = shot.endSec - shot.startSec;
    if (source.kind === "image") {
      segments.push({ shotId: shot.id, fileName: source.fileName, kind: "image", sourceStartSec: 0, lengthSec });
      continue;
    }
    const duration = source.durationSec ?? 0;
    if (lengthSec > duration) {
      problems.push(
        `Shot ${shot.id} is ${lengthSec.toFixed(1)}s but "${source.fileName}" is only ${duration.toFixed(1)}s long.`,
      );
      continue;
    }
    let start = cursor.get(source.fileName) ?? 0;
    if (start + lengthSec > duration) start = 0;
    cursor.set(source.fileName, start + lengthSec);
    segments.push({ shotId: shot.id, fileName: source.fileName, kind: "video", sourceStartSec: start, lengthSec });
  }

  if (problems.length) return { ok: false, problems };
  if (segments.length === 0) return { ok: false, problems: ["The script has no shots to render."] };
  return { ok: true, segments };
}

/** A voiceover line placed at its shot start on the reel timeline. */
export interface VoiceClip {
  path: string;
  startSec: number;
  durationSec: number;
}

/** Program audio sits under the voiceover at this level. */
const PROGRAM_VOLUME_WITH_VOICE = 0.3;

/** A planned segment once its file is on disk and probed for an audio track. */
export interface RenderInput extends PlannedSegment {
  path: string;
  hasAudio: boolean;
}

/**
 * One ffmpeg command: each segment is its own input, so a file can be cut at
 * different points without a split. Video is reframed onto a blurred copy of
 * itself (no cropping of landscape footage), trimmed, and joined. Audio is
 * joined and loudness-normalised to a platform target.
 */
export function buildRenderArgs(
  inputs: RenderInput[],
  size: { w: number; h: number },
  outPath: string,
  voices: VoiceClip[] = [],
): string[] {
  const { w, h } = size;
  const args: string[] = ["-y", "-hide_banner"];
  const parts: string[] = [];
  const concatPairs: string[] = [];

  inputs.forEach((seg, j) => {
    if (seg.kind === "image") args.push("-loop", "1", "-framerate", String(RENDER_FPS), "-i", seg.path);
    else args.push("-i", seg.path);

    const len = seg.lengthSec.toFixed(3);
    const start = seg.sourceStartSec.toFixed(3);
    parts.push(
      `[${j}:v]trim=start=${start}:duration=${len},setpts=PTS-STARTPTS,split[bg${j}][fg${j}];` +
        `[bg${j}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bgb${j}];` +
        `[fg${j}]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs${j}];` +
        `[bgb${j}][fgs${j}]overlay=(W-w)/2:(H-h)/2,fps=${RENDER_FPS},format=yuv420p,setsar=1[v${j}]`,
    );

    if (seg.hasAudio && seg.kind === "video") {
      parts.push(
        `[${j}:a]atrim=start=${start}:duration=${len},asetpts=PTS-STARTPTS,` +
          `aformat=sample_rates=44100:channel_layouts=stereo[a${j}]`,
      );
    } else {
      parts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:duration=${len}[a${j}]`);
    }
    concatPairs.push(`[v${j}][a${j}]`);
  });

  const n = inputs.length;
  parts.push(`${concatPairs.join("")}concat=n=${n}:v=1:a=1[vc][ac]`);

  const loud = "loudnorm=I=-16:TP=-1.5:LRA=11";
  if (voices.length === 0) {
    parts.push(`[ac]${loud}[aout]`);
  } else {
    voices.forEach((v, k) => {
      args.push("-i", v.path);
      const ms = Math.round(v.startSec * 1000);
      parts.push(
        `[${n + k}:a]adelay=${ms}|${ms},aformat=sample_rates=44100:channel_layouts=stereo[vo${k}]`,
      );
    });
    const mixIns = voices.map((_, k) => `[vo${k}]`).join("");
    parts.push(`[ac]volume=${PROGRAM_VOLUME_WITH_VOICE}[bg]`);
    parts.push(
      `[bg]${mixIns}amix=inputs=${voices.length + 1}:duration=first:normalize=0,${loud}[aout]`,
    );
  }

  args.push(
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vc]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outPath,
  );
  return args;
}
