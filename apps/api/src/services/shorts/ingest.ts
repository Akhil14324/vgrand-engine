import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, prisma } from "@catgpt/db";
import { shortsSidecarSchema, type ShortsSidecar } from "@catgpt/types";
import { env } from "../../env.js";
import { buildDims } from "./dims-logic.js";
import { ffmpeg, probeOutput, videoInfo } from "./ffmpeg.js";
import { enqueueJob, PermanentJobError, registerJobHandler } from "./jobs.js";
import { jobKey } from "./jobs-logic.js";
import { log, recordEvent } from "./log.js";
import { pickMusic } from "./music.js";
import { routeForApproval } from "./pipeline.js";
import { ingestViolations } from "./rules-logic.js";
import { nextFreeSlot } from "./schedule-logic.js";
import { cleanTags } from "./script-logic.js";
import { ensureDir, paths, storageRoot } from "./storage.js";
import { failureSummary, validateOutput } from "./validate-logic.js";

/**
 * Path A: finished MP4s rendered elsewhere (code/Blender) become draft videos.
 * Two entry points feed one idempotent `ingest` job:
 *   - watch folder STORAGE_PATH/ingest/<channel-slug>/  (file.mp4 + optional file.json sidecar)
 *   - POST /shorts/channels/:id/ingest (multipart upload)
 * The file's sha256 is the idempotency key, so the same file is never ingested twice.
 */

const STABLE_MS = 30_000;

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

const stagingDir = () => path.join(storageRoot(), "ingest", ".staging");

/** Moves a file into staging and enqueues its ingest job. Returns the job key (or the duplicate's video id). */
export async function stageForIngest(input: {
  channelId: string;
  file: string;
  originalName: string;
  sidecar: ShortsSidecar | null;
  sidecarSource?: string | null;
}): Promise<{ status: "queued" | "duplicate" | "rejected"; detail: string }> {
  const violations = ingestViolations({ fileName: input.originalName, sidecarSource: input.sidecarSource });
  if (violations.length) return { status: "rejected", detail: violations.join("; ") };
  const sha = await sha256File(input.file);
  const dup = await prisma.shortsVideo.findUnique({ where: { ingestKey: sha }, select: { id: true } });
  if (dup) return { status: "duplicate", detail: `already ingested as video ${dup.id}` };
  await ensureDir(stagingDir());
  const staged = path.join(stagingDir(), `${sha}.mp4`);
  await rename(input.file, staged).catch(async () => {
    // Cross-device: copy then delete.
    await writeFile(staged, await readFile(input.file));
    await rm(input.file, { force: true });
  });
  await enqueueJob({
    type: "ingest",
    key: jobKey.ingest(sha),
    channelId: input.channelId,
    payload: { sha, staged, originalName: input.originalName, sidecar: input.sidecar },
    maxAttempts: 3,
  });
  return { status: "queued", detail: sha };
}

/** Ensures an AAC track: keeps the render's own audio; adds a music_library track if it has none. */
async function normalise(src: string, dest: string, channelId: string): Promise<{ addedMusic: string | null }> {
  const info = await videoInfo(src);
  let music: { file: string; path: string } | null = null;
  if (!info.hasAudio) {
    music = await pickMusic(channelId);
    if (!music) {
      throw new PermanentJobError("The MP4 has no audio track and music_library is empty. Add sound to the render or put cleared tracks in music_library.");
    }
  }
  const needsScale = info.width !== 1080 || info.height !== 1920;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", src];
  if (music) args.push("-stream_loop", "-1", "-i", music.path);
  if (needsScale) {
    args.push("-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "30");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
  }
  args.push("-map", "0:v:0", "-map", music ? "1:a:0" : "0:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", dest);
  const r = await ffmpeg(args);
  if (r.code !== 0) throw new Error(`ffmpeg normalise failed: ${r.stderr.slice(-800)}`);
  return { addedMusic: music?.file ?? null };
}

const humanize = (name: string) =>
  name
    .replace(/\.mp4$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "Untitled";

export async function runIngestJob(payload: { sha: string; staged: string; originalName: string; sidecar: ShortsSidecar | null }, channelId: string): Promise<void> {
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: channelId } });
  const existing = await prisma.shortsVideo.findUnique({ where: { ingestKey: payload.sha } });
  if (existing?.filePath) {
    // Done by an earlier attempt; finish routing if it crashed right before that.
    if (existing.status === "rendered") await routeForApproval(existing, channel.approvalMode);
    return;
  }
  if (existing) await prisma.shortsVideo.delete({ where: { id: existing.id } }); // half-made by a crashed attempt
  const video = await prisma.shortsVideo.create({
    data: {
      channelId,
      userId: channel.userId,
      status: "rendered",
      path: "A",
      plannedPath: "A",
      source: "ingest",
      ingestKey: payload.sha,
      title: (payload.sidecar?.title ?? humanize(payload.originalName)).slice(0, 100),
      description: payload.sidecar?.description ?? "",
      tags: cleanTags(payload.sidecar?.tags ?? [channel.niche]),
      hookType: payload.sidecar?.hookType ?? null,
      topic: payload.sidecar?.topic ?? null,
      synthetic: payload.sidecar?.synthetic ?? false,
    },
  });
  try {
    const dir = await ensureDir(paths.videoDir(video.id));
    const out = path.join(dir, "short.mp4");
    const { addedMusic } = await normalise(payload.staged, out, channelId);
    const probe = await probeOutput(out);
    const report = validateOutput(probe, { captionEvents: 0, requireCaptions: false });
    if (!report.ok) throw new PermanentJobError(`Ingested file failed validation: ${failureSummary(report)}`);

    // Slot: the channel's next free posting time.
    const taken = await prisma.shortsVideo.findMany({ where: { channelId, slotAt: { gte: new Date() } }, select: { slotAt: true } });
    const slotAt = nextFreeSlot(channel.postingTimes, env.TIMEZONE, new Date(), new Set(taken.map((t) => t.slotAt!.getTime())));
    await prisma.shortsAsset.create({
      data: {
        videoId: video.id,
        kind: "source_file",
        provider: "path_a",
        providerAssetId: payload.sha.slice(0, 16),
        sourceUrl: `file:${payload.originalName}`,
        license: "Owner's original render (Path A)",
        localPath: out,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
      },
    });
    if (addedMusic) {
      await prisma.shortsAsset.create({ data: { videoId: video.id, kind: "music", provider: "music_library", providerAssetId: addedMusic, license: "Owner-cleared track (music_library)" } });
    }
    const updated = await prisma.shortsVideo.update({
      where: { id: video.id },
      data: {
        filePath: out,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fileSizeBytes: probe.sizeBytes,
        validation: report as unknown as Prisma.InputJsonValue,
        musicTrack: addedMusic,
        slotAt,
        dims: buildDims(channel, { path: "A", hookType: video.hookType, durationSec: probe.durationSec, topic: video.topic, slotAt, synthetic: video.synthetic }, env.TIMEZONE) as Prisma.InputJsonValue,
      },
    });
    await rm(payload.staged, { force: true });
    await recordEvent({ videoId: video.id, channelId, type: "ingest.done", message: `Ingested ${payload.originalName}${addedMusic ? ` (added music ${addedMusic})` : ""}` });
    await routeForApproval(updated, channel.approvalMode);
  } catch (err) {
    // Remove the half-made row so a retry starts clean (ingestKey is unique).
    await prisma.shortsVideo.delete({ where: { id: video.id } }).catch(() => {});
    throw err;
  }
}

/* -------------------------------- watch folder ------------------------------- */

const seenSizes = new Map<string, number>();

/** One pass over every Path A channel's watch folder. Only files unchanged for 30 s are taken. */
export async function scanIngestFolders(opts: { userId?: string; ignoreStability?: boolean } = {}): Promise<{ queued: number; skipped: string[] }> {
  const channels = await prisma.shortsChannel.findMany({ where: { path: "A", ...(opts.userId ? { userId: opts.userId } : {}) } });
  let queued = 0;
  const skipped: string[] = [];
  for (const c of channels) {
    const dir = await ensureDir(paths.ingestDir(c.slug));
    for (const name of await readdir(dir)) {
      if (!/\.mp4$/i.test(name) || name.startsWith(".")) continue;
      const file = path.join(dir, name);
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) continue;
      if (!opts.ignoreStability) {
        const prev = seenSizes.get(file);
        seenSizes.set(file, st.size);
        if (prev !== st.size || Date.now() - st.mtimeMs < STABLE_MS) continue; // still being written
      }
      seenSizes.delete(file);
      let sidecar: ShortsSidecar | null = null;
      let sidecarSource: string | null = null;
      const sidecarPath = file.replace(/\.mp4$/i, ".json");
      const raw = await readFile(sidecarPath, "utf8").catch(() => null);
      if (raw !== null) {
        try {
          const json = JSON.parse(raw) as Record<string, unknown>;
          sidecarSource = typeof json.source === "string" ? json.source : null;
          const parsed = shortsSidecarSchema.safeParse(json);
          if (!parsed.success) throw new Error(`${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
          sidecar = parsed.data;
        } catch (err) {
          await reject(c.slug, file, sidecarPath, `invalid sidecar JSON: ${err instanceof Error ? err.message : err}`);
          skipped.push(name);
          continue;
        }
      }
      const r = await stageForIngest({ channelId: c.id, file, originalName: name, sidecar, sidecarSource });
      if (r.status === "queued") {
        queued++;
        if (raw !== null) await moveTo(paths.ingestDone(c.slug), sidecarPath);
        log.info("ingest.queued", { channel: c.slug, file: name });
      } else {
        await reject(c.slug, file, sidecarPath, r.detail);
        skipped.push(name);
      }
    }
  }
  return { queued, skipped };
}

async function moveTo(dir: string, file: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await rename(file, path.join(dir, path.basename(file))).catch(() => {});
}

/** Moves a refused file aside with a .reason.txt so the owner sees why. */
async function reject(slug: string, file: string, sidecarPath: string, reason: string): Promise<void> {
  const dir = paths.ingestRejected(slug);
  await mkdir(dir, { recursive: true });
  await moveTo(dir, file);
  await moveTo(dir, sidecarPath);
  await writeFile(path.join(dir, `${path.basename(file)}.reason.txt`), `${new Date().toISOString()} ${reason}\n`);
  log.warn("ingest.rejected", { channel: slug, file: path.basename(file), reason });
}

export function registerIngestHandlers(): void {
  registerJobHandler(
    "ingest",
    async (job) => {
      await runIngestJob(job.payload as never, job.channelId!);
    },
    async (job, message) => {
      // Gave up: park the file in rejected/ with the reason and tell the owner.
      const p = job.payload as { staged: string; originalName: string };
      const channel = await prisma.shortsChannel.findUnique({ where: { id: job.channelId! } });
      if (channel) {
        const dir = paths.ingestRejected(channel.slug);
        await mkdir(dir, { recursive: true });
        await rename(p.staged, path.join(dir, p.originalName)).catch(() => {});
        await writeFile(path.join(dir, `${p.originalName}.reason.txt`), `${new Date().toISOString()} ${message}\n`).catch(() => {});
      }
      await recordEvent({ channelId: job.channelId, level: "error", type: "ingest.failed", message: `${p.originalName}: ${message}` });
    },
  );
}
