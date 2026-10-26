import type { ReelScript, VideoResolution } from "@catgpt/types";

/**
 * Pure render planning: turns a shot list into timed segments and one ffmpeg
 * command. No I/O here, so the rules are testable.
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
  /** Source file for footage shots; null for motion-graphic shots. */
  fileName: string | null;
  kind: "image" | "video" | "motion" | "generated";
  /** Where in the source file this shot starts. Images and motion always start at 0. */
  sourceStartSec: number;
  lengthSec: number;
  /** Text laid over the shot as a caption (footage shots only). */
  caption: string | null;
  /** Text for a motion-graphic card. */
  motionText: string | null;
  /** Prompt for a generated clip. */
  prompt: string | null;
}

export type SegmentPlan =
  | { ok: true; segments: PlannedSegment[] }
  | { ok: false; problems: string[] };

/**
 * Plans footage and motion-graphic shots in order. Shots that use the same
 * video continue where the previous shot stopped, so the reel doesn't replay
 * the same seconds. If the file runs out, the shot starts again from the start.
 * Generated shots are refused until a video model is connected.
 */
export function planFootageSegments(script: ReelScript, sources: SourceInfo[]): SegmentPlan {
  const problems: string[] = [];
  const segments: PlannedSegment[] = [];
  const cursor = new Map<string, number>();
  const byName = new Map(sources.map((s) => [s.fileName, s]));

  const shots = [...script.shots].sort((a, b) => a.startSec - b.startSec);
  for (const shot of shots) {
    const lengthSec = shot.endSec - shot.startSec;

    if (shot.kind === "generate") {
      segments.push({
        shotId: shot.id,
        fileName: null,
        kind: "generated",
        sourceStartSec: 0,
        lengthSec,
        caption: shot.onScreenText ?? null,
        motionText: null,
        prompt: shot.description,
      });
      continue;
    }
    if (shot.kind === "motion_graphic") {
      segments.push({
        shotId: shot.id,
        fileName: null,
        kind: "motion",
        sourceStartSec: 0,
        lengthSec,
        caption: null,
        motionText: shot.onScreenText ?? shot.description,
        prompt: null,
      });
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
    const caption = shot.onScreenText ?? null;
    if (source.kind === "image") {
      segments.push({
        shotId: shot.id,
        fileName: source.fileName,
        kind: "image",
        sourceStartSec: 0,
        lengthSec,
        caption,
        motionText: null,
        prompt: null,
      });
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
    segments.push({
      shotId: shot.id,
      fileName: source.fileName,
      kind: "video",
      sourceStartSec: start,
      lengthSec,
      caption,
      motionText: null,
      prompt: null,
    });
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

/**
 * A planned segment once its media is on disk. `path` is the source file, or
 * the rendered motion clip for a motion shot. `captionPath` is an alpha WebM.
 */
export interface RenderInput {
  shotId: string;
  kind: "image" | "video";
  sourceStartSec: number;
  lengthSec: number;
  path: string;
  hasAudio: boolean;
  captionPath?: string | null;
}

/**
 * One ffmpeg command. Each segment is its own input, so a file can be cut at
 * different points without a split. Video is reframed onto a blurred copy of
 * itself (landscape footage isn't cropped), captions are overlaid, then the
 * segments are joined. Audio is joined, voiceover is mixed in at each shot
 * start, and the result is loudness-normalised.
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
  const joined: string[] = [];
  let next = 0;

  inputs.forEach((seg, j) => {
    const videoIn = next++;
    if (seg.kind === "image") args.push("-loop", "1", "-framerate", String(RENDER_FPS), "-i", seg.path);
    else args.push("-i", seg.path);

    const len = seg.lengthSec.toFixed(3);
    const start = seg.sourceStartSec.toFixed(3);
    parts.push(
      `[${videoIn}:v]trim=start=${start}:duration=${len},setpts=PTS-STARTPTS,split[bg${j}][fg${j}];` +
        `[bg${j}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bgb${j}];` +
        `[fg${j}]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs${j}];` +
        `[bgb${j}][fgs${j}]overlay=(W-w)/2:(H-h)/2,fps=${RENDER_FPS},format=yuv420p,setsar=1[v${j}]`,
    );

    let videoLabel = `v${j}`;
    if (seg.captionPath) {
      args.push("-c:v", "libvpx-vp9", "-i", seg.captionPath);
      const capIn = next++;
      parts.push(`[v${j}][${capIn}:v]overlay=0:0:shortest=1,format=yuv420p[v${j}c]`);
      videoLabel = `v${j}c`;
    }

    if (seg.hasAudio && seg.kind === "video") {
      parts.push(
        `[${videoIn}:a]atrim=start=${start}:duration=${len},asetpts=PTS-STARTPTS,` +
          `aformat=sample_rates=44100:channel_layouts=stereo[a${j}]`,
      );
    } else {
      parts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:duration=${len}[a${j}]`);
    }
    joined.push(`[${videoLabel}]`, `[a${j}]`);
  });

  const n = inputs.length;
  parts.push(`${joined.join("")}concat=n=${n}:v=1:a=1[vc][ac]`);

  const loud = "loudnorm=I=-16:TP=-1.5:LRA=11";
  if (voices.length === 0) {
    parts.push(`[ac]${loud}[aout]`);
  } else {
    voices.forEach((v, k) => {
      args.push("-i", v.path);
      const ms = Math.round(v.startSec * 1000);
      parts.push(`[${next + k}:a]adelay=${ms}|${ms},aformat=sample_rates=44100:channel_layouts=stereo[vo${k}]`);
    });
    const mixIns = voices.map((_, k) => `[vo${k}]`).join("");
    parts.push(`[ac]volume=${PROGRAM_VOLUME_WITH_VOICE}[bg]`);
    parts.push(`[bg]${mixIns}amix=inputs=${voices.length + 1}:duration=first:normalize=0,${loud}[aout]`);
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
