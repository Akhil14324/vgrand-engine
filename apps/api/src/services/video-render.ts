import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@catgpt/db";
import { reelBriefSchema, type ReelScript } from "@catgpt/types";
import { fetchVideo } from "./social/media/fetch-video.js";
import { run, parseFfmpegInfo, probeVideo } from "./social/media/video.js";
import { ffmpegPath } from "./social/media/youtube-video.js";
import { storeImage } from "./storage.js";
import { buildRenderArgs, planFootageSegments, RENDER_SIZES, type RenderInput } from "./video-render-logic.js";

/** Accept the rendered length if it's within this many seconds of the brief (frame rounding). */
const DURATION_TOLERANCE_SEC = 1;

/** Probe whether a file has an audio track. Images never do. */
async function hasAudioTrack(filePath: string): Promise<boolean> {
  const bin = await ffmpegPath();
  const { stderr } = await run(bin, ["-hide_banner", "-i", filePath]);
  return parseFfmpegInfo(stderr)?.audioCodec != null;
}

/**
 * Renders a footage-only reel in the background. The route has already moved
 * the project to `editing`. Ends in `review` with `outputUrl` set, or in
 * `failed`. Internal details go to the server log; the stored message is
 * generic.
 */
export async function runRenderJob(projectId: string): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { folder: { include: { assets: true } } },
    });
    if (!project || !project.script) throw new Error("render started without a script");

    const brief = reelBriefSchema.parse(project.brief);
    const script = project.script as unknown as ReelScript;
    const assets = project.folder?.assets ?? [];
    const plan = planFootageSegments(
      script,
      assets.map((a) => ({
        fileName: a.fileName,
        kind: a.kind === "video" ? "video" : "image",
        durationSec: a.durationSec,
      })),
    );
    if (!plan.ok) throw new RenderPlanError(plan.problems.join(" "));

    // Download and probe each distinct source once, then reuse it for every shot.
    const sourcePaths = new Map<string, { path: string; hasAudio: boolean }>();
    for (const seg of plan.segments) {
      if (sourcePaths.has(seg.fileName)) continue;
      const asset = assets.find((a) => a.fileName === seg.fileName)!;
      const buffer = await fetchVideo(asset.url);
      const filePath = path.join(workDir, `src-${sourcePaths.size}`);
      await writeFile(filePath, buffer);
      const hasAudio = seg.kind === "video" ? await hasAudioTrack(filePath) : false;
      sourcePaths.set(seg.fileName, { path: filePath, hasAudio });
    }

    const inputs: RenderInput[] = plan.segments.map((seg) => {
      const src = sourcePaths.get(seg.fileName)!;
      return { ...seg, path: src.path, hasAudio: src.hasAudio };
    });
    const size = RENDER_SIZES[brief.aspectRatio]![brief.resolution];
    const outPath = path.join(workDir, "reel.mp4");
    const bin = await ffmpegPath();
    const { code, stderr } = await run(bin, buildRenderArgs(inputs, size!, outPath));
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
    const message =
      err instanceof RenderPlanError ? err.message : "The reel could not be rendered. Try again.";
    await prisma.videoProject.updateMany({
      where: { id: projectId, status: "editing" },
      data: { status: "failed", errorMessage: message },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** A problem the user can fix (missing file, short clip). Its text is safe to show. */
class RenderPlanError extends Error {}

/** Runs the same plan check the route does, so the user gets problems before the job starts. */
export function checkRenderPlan(script: ReelScript, sources: { fileName: string; kind: string; durationSec: number | null }[]) {
  return planFootageSegments(
    script,
    sources.map((s) => ({
      fileName: s.fileName,
      kind: s.kind === "video" ? "video" : "image",
      durationSec: s.durationSec,
    })),
  );
}
