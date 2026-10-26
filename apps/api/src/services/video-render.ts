import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@catgpt/db";
import { MOTION_FPS, type MotionClipProps } from "@catgpt/motion";
import { renderMotionClip } from "@catgpt/motion/render";
import { reelBriefSchema, type BrandProfile, type ReelScript } from "@catgpt/types";
import { fetchVideo } from "./social/media/fetch-video.js";
import { parseFfmpegInfo, probeVideo, run } from "./social/media/video.js";
import { ffmpegPath } from "./social/media/youtube-video.js";
import { storeImage } from "./storage.js";
import { parseAudioDuration, synthesizeLine, VoiceConfigError } from "./voice-tts.js";
import {
  buildRenderArgs,
  planFootageSegments,
  RENDER_SIZES,
  type PlannedSegment,
  type RenderInput,
  type SourceInfo,
  type VoiceClip,
} from "./video-render-logic.js";

/** Accept the rendered length if it's within this many seconds of the brief (frame rounding). */
const DURATION_TOLERANCE_SEC = 1;

const DEFAULT_BACKGROUND = "#111111";
const DEFAULT_ACCENT = "#ffffff";

/** A problem the user can fix (missing file, short clip, long voiceover). Its text is safe to show. */
class RenderPlanError extends Error {}

/** Probe whether a file has an audio track. Images never do. */
async function hasAudioTrack(filePath: string): Promise<boolean> {
  const bin = await ffmpegPath();
  const { stderr } = await run(bin, ["-hide_banner", "-i", filePath]);
  return parseFfmpegInfo(stderr)?.audioCodec != null;
}

/** Brand palette for motion graphics: first colour as the card background, second as the accent. */
function brandPalette(profile: BrandProfile | null): { background: string; accent: string } {
  const colors = profile?.colors ?? [];
  return { background: colors[0] ?? DEFAULT_BACKGROUND, accent: colors[1] ?? DEFAULT_ACCENT };
}

/** The same plan check the route runs, so the user gets problems before the job starts. */
export function checkRenderPlan(script: ReelScript, sources: { fileName: string; kind: string; durationSec: number | null }[]) {
  return planFootageSegments(
    script,
    sources.map((s): SourceInfo => ({
      fileName: s.fileName,
      kind: s.kind === "video" ? "video" : "image",
      durationSec: s.durationSec,
    })),
  );
}

/**
 * Renders a reel in the background. The route has already moved the project to
 * `editing`. Ends in `review` with `outputUrl` set, or in `failed`. Internal
 * details go to the server log; the stored message is generic.
 */
export async function runRenderJob(projectId: string): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        folder: { include: { assets: true } },
        brand: { select: { profile: true } },
      },
    });
    if (!project || !project.script) throw new Error("render started without a script");

    const brief = reelBriefSchema.parse(project.brief);
    const script = project.script as unknown as ReelScript;
    const assets = project.folder?.assets ?? [];
    const plan = checkRenderPlan(
      script,
      assets.map((a) => ({
        fileName: a.fileName,
        kind: a.kind === "video" ? "video" : "image",
        durationSec: a.durationSec,
      })),
    );
    if (!plan.ok) throw new RenderPlanError(plan.problems.join(" "));

    const size = RENDER_SIZES[brief.aspectRatio]![brief.resolution]!;
    const palette = brandPalette((project.brand.profile as BrandProfile | null) ?? null);
    const bin = await ffmpegPath();

    // Download and probe each distinct source once, then reuse it for every shot.
    const sources = new Map<string, { path: string; hasAudio: boolean }>();
    for (const seg of plan.segments) {
      if (seg.kind === "motion" || sources.has(seg.fileName!)) continue;
      const asset = assets.find((a) => a.fileName === seg.fileName)!;
      const buffer = await fetchVideo(asset.url);
      const filePath = path.join(workDir, `src-${sources.size}`);
      await writeFile(filePath, buffer);
      const hasAudio = seg.kind === "video" ? await hasAudioTrack(filePath) : false;
      sources.set(seg.fileName!, { path: filePath, hasAudio });
    }

    const inputs: RenderInput[] = [];
    for (const seg of plan.segments) {
      inputs.push(await segmentInput(seg, sources, palette, size, workDir));
    }

    // Voiceover: one line per shot, placed at the shot start. Each line must fit its shot.
    const voices: VoiceClip[] = [];
    if (brief.voiceProvider !== "none") {
      for (const shot of [...script.shots].sort((a, b) => a.startSec - b.startSec)) {
        if (!shot.voiceover) continue;
        const audio = await synthesizeLine({
          provider: brief.voiceProvider,
          text: shot.voiceover,
          voiceId: brief.voiceId,
        });
        const voicePath = path.join(workDir, `vo-${shot.id}.mp3`);
        await writeFile(voicePath, audio);
        const { stderr: probe } = await run(bin, ["-hide_banner", "-i", voicePath]);
        const durationSec = parseAudioDuration(probe);
        if (durationSec === null) throw new RenderPlanError(`The voiceover for shot ${shot.id} could not be read.`);
        const shotLength = shot.endSec - shot.startSec;
        if (durationSec > shotLength + 0.25) {
          throw new RenderPlanError(
            `The voiceover for shot ${shot.id} runs ${durationSec.toFixed(1)}s, longer than its ${shotLength.toFixed(1)}s shot. Shorten the line.`,
          );
        }
        voices.push({ path: voicePath, startSec: shot.startSec, durationSec });
      }
    }

    const outPath = path.join(workDir, "reel.mp4");
    const { code, stderr } = await run(bin, buildRenderArgs(inputs, size, outPath, voices));
    if (code !== 0) {
      throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`);
    }

    const info = await probeVideo(await readFile(outPath));
    if (Math.abs(info.durationSec - brief.durationSec) > DURATION_TOLERANCE_SEC) {
      throw new Error(`rendered ${info.durationSec}s, expected ${brief.durationSec}s`);
    }

    const buffer = await readFile(outPath);
    const outputUrl = await storeImage({
      buffer,
      mimeType: "video/mp4",
      keyPrefix: `video-outputs/${project.userId}`,
    });
    await prisma.videoProject.updateMany({
      where: { id: projectId, status: "editing" },
      data: { status: "review", outputUrl, errorMessage: null },
    });
  } catch (err) {
    console.error("[video-render] failed", projectId, err);
    const userFacing = err instanceof RenderPlanError || err instanceof VoiceConfigError;
    const message = userFacing ? err.message : "The reel could not be rendered. Try again.";
    await prisma.videoProject.updateMany({
      where: { id: projectId, status: "editing" },
      data: { status: "failed", errorMessage: message },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Turns one planned segment into a render input. Motion and caption clips are rendered with Remotion. */
async function segmentInput(
  seg: PlannedSegment,
  sources: Map<string, { path: string; hasAudio: boolean }>,
  palette: { background: string; accent: string },
  size: { w: number; h: number },
  workDir: string,
): Promise<RenderInput> {
  const durationFrames = Math.max(1, Math.round(seg.lengthSec * MOTION_FPS));
  const shared = {
    width: size.w,
    height: size.h,
    durationFrames,
    color: "#ffffff",
    accent: palette.accent,
    sub: null,
  };

  let captionPath: string | null = null;
  if (seg.caption) {
    captionPath = path.join(workDir, `cap-${seg.shotId}.webm`);
    const props: MotionClipProps = { ...shared, mode: "caption", text: seg.caption, background: "transparent" };
    await renderMotionClip(props, captionPath);
  }

  if (seg.kind === "motion") {
    const clipPath = path.join(workDir, `motion-${seg.shotId}.mp4`);
    const props: MotionClipProps = {
      ...shared,
      mode: "card",
      text: seg.motionText ?? "",
      background: palette.background,
    };
    await renderMotionClip(props, clipPath);
    return {
      shotId: seg.shotId,
      kind: "video",
      sourceStartSec: 0,
      lengthSec: seg.lengthSec,
      path: clipPath,
      hasAudio: false,
      captionPath,
    };
  }

  const src = sources.get(seg.fileName!)!;
  return {
    shotId: seg.shotId,
    kind: seg.kind === "image" ? "image" : "video",
    sourceStartSec: seg.sourceStartSec,
    lengthSec: seg.lengthSec,
    path: src.path,
    hasAudio: src.hasAudio,
    captionPath,
  };
}
