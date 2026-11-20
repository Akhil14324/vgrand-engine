import { copyFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, prisma } from "@catgpt/db";
import type { ShortsStatus, ShortsStyleNotes } from "@catgpt/types";
import { env } from "../../env.js";
import { buildAss, beatSpans, type WordTiming } from "./captions-logic.js";
import { buildComposeArgs, clipStart, targetDuration, type ComposeClip } from "./compose-logic.js";
import { buildDims } from "./dims-logic.js";
import { ffmpeg, mediaDuration, probeOutput, videoInfo } from "./ffmpeg.js";
import { enqueueJob, PermanentJobError, registerJobHandler, type ShortsJobRow } from "./jobs.js";
import { jobKey } from "./jobs-logic.js";
import { log, recordEvent } from "./log.js";
import { pickMusic } from "./music.js";
import { providersFor } from "./providers.js";
import { DUPLICATE_WINDOW_DAYS, pathBViolations } from "./rules-logic.js";
import {
  buildScriptPrompt,
  cleanTags,
  narrationOf,
  scriptHash,
  scriptOutputSchema,
  scriptProblems,
  type ScriptOutput,
} from "./script-logic.js";
import { footageHash, keyOf, pickClips, type StockCandidate } from "./stock-logic.js";
import { ensureDir, paths } from "./storage.js";
import { resolveShortsVoice } from "./tts.js";
import { failureSummary, validateOutput } from "./validate-logic.js";
import { getVideo, transition, type ShortsVideoRow } from "./videos.js";
import { generateClipsForVideo, PathCFallback } from "./pathc.js";

const FONTS_DIR = fileURLToPath(new URL("../../../assets/fonts", import.meta.url));
const MAX_SCRIPT_ATTEMPTS = 3;
const dayMs = 24 * 60 * 60_000;

/** Stored per beat on the video once footage and timing are known. */
export interface BeatRecord {
  narration: string;
  queries: string[];
  startSec?: number;
  endSec?: number;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/* --------------------------------- creation -------------------------------- */

/** Creates a video row in `idea` and enqueues its first step. Idempotent per (channel, slot). */
export async function createVideo(input: {
  channelId: string;
  slotAt?: Date | null;
  source?: "scheduler" | "manual" | "dry_run";
}): Promise<{ video: ShortsVideoRow; created: boolean }> {
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: input.channelId } });
  if (channel.path === "A") throw new PermanentJobError("Path A channels don't generate videos; drop files into the ingest folder instead");
  let video: ShortsVideoRow;
  let created = true;
  try {
    video = await prisma.shortsVideo.create({
      data: {
        channelId: channel.id,
        userId: channel.userId,
        status: "idea",
        path: channel.path,
        plannedPath: channel.path,
        source: input.source ?? "manual",
        slotAt: input.slotAt ?? null,
        synthetic: channel.path === "C",
        dims: buildDims(channel, { path: channel.path, slotAt: input.slotAt ?? null, synthetic: channel.path === "C" }, env.TIMEZONE) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && input.slotAt) {
      video = await prisma.shortsVideo.findFirstOrThrow({ where: { channelId: channel.id, slotAt: input.slotAt } });
      created = false;
    } else throw err;
  }
  await enqueueJob({ type: "script", key: jobKey.script(video.id), videoId: video.id, channelId: channel.id });
  if (created) await recordEvent({ videoId: video.id, channelId: channel.id, type: "video.created", message: `New ${channel.path} video (${video.source})` });
  return { video, created };
}

/* ---------------------------------- script --------------------------------- */

async function recentTitles(channelId: string, excludeId: string): Promise<string[]> {
  const rows = await prisma.shortsVideo.findMany({
    where: { channelId, id: { not: excludeId }, title: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { title: true },
    take: 30,
  });
  return rows.map((r) => r.title!);
}

async function isDuplicateScript(channelId: string, hash: string, excludeId: string): Promise<boolean> {
  const hit = await prisma.shortsVideo.findFirst({
    where: {
      channelId,
      id: { not: excludeId },
      scriptHash: hash,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_DAYS * dayMs) },
    },
    select: { id: true },
  });
  return !!hit;
}

export async function runScriptStep(videoId: string): Promise<void> {
  const video = await getVideo(videoId);
  if (video.status !== "idea") return; // already done by an earlier run
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: video.channelId } });
  const style = channel.styleNotes as unknown as ShortsStyleNotes;
  const providers = providersFor(video);
  const titles = await recentTitles(channel.id, video.id);

  const requests: unknown[] = [];
  const responses: unknown[] = [];
  let avoidNote: string | null = null;
  let accepted: ScriptOutput | null = null;
  let lastProblem = "";

  for (let attempt = 1; attempt <= MAX_SCRIPT_ATTEMPTS && !accepted; attempt++) {
    const prompt = buildScriptPrompt({ channelName: channel.displayName, niche: channel.niche, styleNotes: style, recentTitles: titles, avoidNote });
    const call = await providers.script(prompt);
    requests.push(call.request);
    responses.push(call.response);
    const parsed = scriptOutputSchema.safeParse(call.parsed);
    if (!parsed.success) {
      lastProblem = `reply did not match the schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`;
      avoidNote = `Your previous reply was invalid (${lastProblem}). Follow the JSON schema exactly.`;
      continue;
    }
    const problems = scriptProblems(parsed.data, style.bannedTopics ?? []);
    if (problems.length) {
      lastProblem = problems.join("; ");
      avoidNote = `Your previous script was rejected: ${lastProblem}. Fix these.`;
      continue;
    }
    if (await isDuplicateScript(channel.id, scriptHash(narrationOf(parsed.data)), video.id)) {
      lastProblem = "near-duplicate of a script used in the last 30 days";
      avoidNote = `Your previous script ("${parsed.data.title}") duplicates one already published. Pick a different topic and hook.`;
      await recordEvent({ videoId, channelId: channel.id, level: "warn", type: "script.duplicate", message: `Rejected duplicate script "${parsed.data.title}"` });
      continue;
    }
    accepted = parsed.data;
  }

  const llm = { llmPrompt: requests as Prisma.InputJsonValue, llmResponse: responses as Prisma.InputJsonValue };
  if (!accepted) {
    await prisma.shortsVideo.update({ where: { id: videoId }, data: llm });
    throw new PermanentJobError(`No usable script after ${MAX_SCRIPT_ATTEMPTS} attempts: ${lastProblem}`);
  }

  const narration = narrationOf(accepted);
  const beats: BeatRecord[] = accepted.beats.map((b) => ({ narration: b.narration, queries: b.searchQueries }));
  const moved = await transition(videoId, "idea", "scripted", {
    ...llm,
    title: accepted.title.trim(),
    description: accepted.description.trim(),
    tags: cleanTags(accepted.tags),
    hook: accepted.hook.trim(),
    hookType: accepted.hookType,
    topic: accepted.topic,
    narration,
    beats: beats as unknown as Prisma.InputJsonValue,
    scriptHash: scriptHash(narration),
    dims: { ...(video.dims as object), hookType: accepted.hookType, topic: accepted.topic } as Prisma.InputJsonValue,
  });
  if (moved) await enqueueJob({ type: "assets", key: jobKey.assets(videoId), videoId, channelId: channel.id });
}

/* ---------------------------------- assets --------------------------------- */

async function recentlyUsedFootage(channelId: string, excludeVideoId: string): Promise<Set<string>> {
  const rows = await prisma.shortsAsset.findMany({
    where: {
      kind: { in: ["stock_video", "generated_clip"] },
      video: { channelId, id: { not: excludeVideoId }, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_DAYS * dayMs) } },
    },
    select: { provider: true, providerAssetId: true },
  });
  return new Set(rows.map((r) => `${r.provider}:${r.providerAssetId}`));
}

/** Voiceover first (its timing decides how long each clip must be). Reused on retry so TTS isn't paid twice. */
async function ensureVoice(video: ShortsVideoRow, channel: { voiceId: string | null }, dir: string) {
  const voicePath = path.join(dir, "voice.mp3");
  let words = video.wordTimings as unknown as WordTiming[] | null;
  let voiceId = video.voiceId;
  if (!words || !(await exists(voicePath))) {
    const providers = providersFor(video);
    voiceId = providers.name === "offline" ? "offline" : resolveShortsVoice(channel.voiceId);
    const r = await providers.voice(video.narration!, voiceId, voicePath);
    words = r.words;
    await prisma.shortsVideo.update({ where: { id: video.id }, data: { wordTimings: words as unknown as Prisma.InputJsonValue, voiceId } });
    await prisma.shortsAsset.deleteMany({ where: { videoId: video.id, kind: "voiceover" } });
    await prisma.shortsAsset.create({
      data: {
        videoId: video.id,
        kind: "voiceover",
        provider: providers.name === "offline" ? "offline_fixture" : "elevenlabs",
        providerAssetId: voiceId,
        license: providers.name === "offline" ? "Generated test tone (offline dry run)" : "ElevenLabs generated speech; commercial use per the account's ElevenLabs plan",
        licenseUrl: providers.name === "offline" ? null : "https://elevenlabs.io/terms-of-use",
        localPath: voicePath,
        meta: { modelId: r.modelId, words: words.length },
      },
    });
  }
  const voiceSec = await mediaDuration(voicePath);
  return { voicePath, words: words!, voiceId, voiceSec };
}

export async function runAssetsStep(videoId: string): Promise<void> {
  let video = await getVideo(videoId);
  if (video.status !== "scripted") return;
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: video.channelId } });
  const dir = await ensureDir(paths.videoDir(videoId));
  const beats = video.beats as unknown as BeatRecord[];

  const { words, voiceSec } = await ensureVoice(video, channel, dir);
  const total = targetDuration(voiceSec);
  if (total === null) throw new PermanentJobError(`Voiceover is ${voiceSec.toFixed(1)}s; a Short must be at most 45s`);
  const spans = beatSpans(video.hook!, beats.map((b) => b.narration), words, total);
  const timedBeats = beats.map((b, i) => ({ ...b, startSec: +spans[i]!.start.toFixed(3), endSec: +spans[i]!.end.toFixed(3) }));

  video = await getVideo(videoId);
  // Path C: generated clips (budget-checked). Falls back to stock (Path B) on cap/failure.
  if (video.path === "C") {
    try {
      await generateClipsForVideo(video, channel, timedBeats, dir);
    } catch (err) {
      if (!(err instanceof PathCFallback)) throw err;
      if (channel.fallbackPath !== "B") {
        throw new PermanentJobError(`Path C failed and this channel has no fallback path: ${err.message}`);
      }
      await prisma.shortsVideo.update({ where: { id: videoId }, data: { path: "B", synthetic: false } });
      await recordEvent({
        videoId,
        channelId: channel.id,
        level: "warn",
        type: "pathc.fallback",
        message: `Path C -> fallback B: ${err.message}`,
        data: { reason: err.reason },
      });
      video = await getVideo(videoId);
    }
  }
  if (video.path === "B") await pickAndDownloadStock(video, channel, timedBeats, dir);

  const music = await pickMusic(channel.id);
  await prisma.shortsAsset.deleteMany({ where: { videoId, kind: "music" } });
  if (music) {
    await prisma.shortsAsset.create({
      data: { videoId, kind: "music", provider: "music_library", providerAssetId: music.file, license: "Owner-cleared track (music_library)", localPath: music.path },
    });
  }

  const moved = await transition(videoId, "scripted", "assets_ready", {
    beats: timedBeats as unknown as Prisma.InputJsonValue,
    musicTrack: music?.file ?? null,
  });
  if (moved) await enqueueJob({ type: "render", key: jobKey.render(videoId), videoId, channelId: channel.id });
}

async function pickAndDownloadStock(
  video: ShortsVideoRow,
  channel: { id: string; niche: string; stockKeywords: string[] },
  beats: Required<BeatRecord>[],
  dir: string,
): Promise<void> {
  const providers = providersFor(video);
  const recent = await recentlyUsedFootage(channel.id, video.id);
  const needs = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    const neededSec = b.endSec - b.startSec;
    const queries = [...b.queries, ...channel.stockKeywords, channel.niche];
    const seen = new Set<string>();
    const candidates: StockCandidate[] = [];
    // Try the beat's own queries first; fall back to channel seeds until there is enough choice.
    for (const q of queries) {
      if (candidates.length >= 12) break;
      for (const c of await providers.searchStock(q)) {
        if (!seen.has(keyOf(c))) {
          seen.add(keyOf(c));
          candidates.push(c);
        }
      }
    }
    needs.push({ index: i, neededSec, candidates });
  }
  const picks = pickClips(needs, recent);
  const missing = picks.map((p, i) => (p ? null : i)).filter((x): x is number => x !== null);
  if (missing.length) throw new Error(`No usable vertical/croppable stock clip for beat(s) ${missing.join(", ")}`);

  const keys = picks.map((p) => keyOf(p!.clip));
  const fHash = footageHash(keys);
  const sameFootage = await prisma.shortsVideo.findFirst({
    where: { channelId: channel.id, id: { not: video.id }, footageHash: fHash, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_DAYS * dayMs) } },
    select: { id: true },
  });
  if (sameFootage) throw new PermanentJobError("Near-duplicate: the same footage set was used by this channel in the last 30 days");

  await prisma.shortsAsset.deleteMany({ where: { videoId: video.id, kind: "stock_video" } });
  for (const p of picks) {
    const c = p!.clip;
    const file = path.join(dir, `clip-${p!.beatIndex}-${c.provider}-${c.id}.mp4`);
    if (!(await exists(file))) await providers.downloadStock(c, file);
    const info = await videoInfo(file);
    await prisma.shortsAsset.create({
      data: {
        videoId: video.id,
        kind: "stock_video",
        provider: c.provider,
        providerAssetId: c.id,
        sourceUrl: c.pageUrl,
        downloadUrl: c.downloadUrl,
        license: c.license,
        licenseUrl: c.licenseUrl,
        author: c.author,
        authorUrl: c.authorUrl,
        beatIndex: p!.beatIndex,
        localPath: file,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        meta: { reusedWithin30Days: p!.reused },
      },
    });
  }
  await prisma.shortsVideo.update({ where: { id: video.id }, data: { footageHash: fHash } });
}

/* ---------------------------------- render --------------------------------- */

export async function runRenderStep(videoId: string): Promise<void> {
  const video = await getVideo(videoId);
  if (video.status !== "assets_ready") return;
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: video.channelId } });
  const assets = await prisma.shortsAsset.findMany({ where: { videoId } });
  const dir = await ensureDir(paths.videoDir(videoId));

  if (video.path === "B") {
    const violations = pathBViolations({ narration: video.narration, assets, dryRun: video.source === "dry_run" });
    if (violations.length) throw new PermanentJobError(`Content rules: ${violations.join("; ")}`);
  }

  const beats = video.beats as unknown as Required<BeatRecord>[];
  const words = video.wordTimings as unknown as WordTiming[];
  const voice = assets.find((a) => a.kind === "voiceover")!;
  const music = assets.find((a) => a.kind === "music") ?? null;
  const voiceSec = await mediaDuration(voice.localPath!);
  const total = targetDuration(voiceSec)!;

  const clipKind = video.path === "C" ? "generated_clip" : "stock_video";
  const clips: ComposeClip[] = beats.map((b, i) => {
    const a = assets.find((x) => x.kind === clipKind && x.beatIndex === i);
    if (!a?.localPath || !a.durationSec) throw new PermanentJobError(`Missing footage for beat ${i}`);
    const lengthSec = +(b.endSec - b.startSec).toFixed(3);
    const startSec = clipStart(a.durationSec, lengthSec);
    return { path: a.localPath, startSec, lengthSec, loop: a.durationSec < startSec + lengthSec + 0.05 };
  });

  const { ass, events } = buildAss(words);
  await writeFile(path.join(dir, "captions.ass"), ass);
  const fontsOut = await ensureDir(path.join(dir, "fonts"));
  for (const f of await readdir(FONTS_DIR)) if (/\.(ttf|otf)$/i.test(f)) await copyFile(path.join(FONTS_DIR, f), path.join(fontsOut, f));

  const tmpOut = path.join(dir, "short.tmp.mp4");
  const finalOut = path.join(dir, "short.mp4");
  const args = buildComposeArgs({
    clips,
    voicePath: voice.localPath!,
    musicPath: music?.localPath ?? null,
    assFile: "captions.ass",
    fontsDir: "fonts",
    totalSec: total,
    outFile: tmpOut,
  });
  const started = Date.now();
  const r = await ffmpeg(args, { cwd: dir });
  if (r.code !== 0) throw new Error(`ffmpeg exited ${r.code}: ${r.stderr.slice(-1500)}`);

  const probe = await probeOutput(tmpOut);
  const report = validateOutput(probe, { captionEvents: events, requireCaptions: true });
  if (!report.ok) {
    await prisma.shortsVideo.update({ where: { id: videoId }, data: { validation: report as unknown as Prisma.InputJsonValue } });
    await recordEvent({ videoId, channelId: channel.id, level: "error", type: "render.invalid", message: failureSummary(report) });
    throw new PermanentJobError(`Rendered file failed validation: ${failureSummary(report)}`);
  }
  await rename(tmpOut, finalOut);
  log.info("render.done", { videoId, ms: Date.now() - started, durationSec: probe.durationSec, bytes: probe.sizeBytes });

  const dims = buildDims(
    channel,
    { path: video.path, hookType: video.hookType, durationSec: probe.durationSec, voiceId: video.voiceId, topic: video.topic, slotAt: video.slotAt, synthetic: video.synthetic },
    env.TIMEZONE,
  );
  const rendered = await transition(videoId, "assets_ready", "rendered", {
    filePath: finalOut,
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    fileSizeBytes: probe.sizeBytes,
    validation: report as unknown as Prisma.InputJsonValue,
    dims: dims as Prisma.InputJsonValue,
    error: null,
  });
  if (rendered) await routeForApproval(rendered, channel.approvalMode);
}

/** After a valid render: manual channels wait for the owner, auto channels go straight to posting. */
export async function routeForApproval(video: ShortsVideoRow, approvalMode: string): Promise<void> {
  if (approvalMode === "auto") {
    const v = await transition(video.id, "rendered", "approved", { approvedAt: new Date() }, "auto approval");
    if (v) await enqueuePost(v);
  } else {
    await transition(video.id, "rendered", "awaiting_approval");
  }
}

/** Posting step (upload or manual queue). Decides at once; an upload defers itself until shortly before the slot. */
export async function enqueuePost(video: ShortsVideoRow, round = 0): Promise<void> {
  await enqueueJob({ type: "post", key: jobKey.upload(video.id, round), videoId: video.id, channelId: video.channelId, maxAttempts: 5 });
}

/* ---------------------------------- failure -------------------------------- */

/** A job gave up: mark the video failed with the reason, keeping its last good status for retry. */
export async function markFailed(job: ShortsJobRow, message: string): Promise<void> {
  if (!job.videoId) return;
  const video = await prisma.shortsVideo.findUnique({ where: { id: job.videoId } });
  if (!video || ["posted", "manual_posted", "failed", "rejected"].includes(video.status)) return;
  await transition(video.id, video.status as ShortsStatus, "failed", { error: `[${job.type}] ${message}`.slice(0, 4000) }, message.slice(0, 300));
  await recordEvent({ videoId: video.id, channelId: video.channelId, level: "error", type: "video.failed", message: `${job.type}: ${message}`, data: { failedFrom: video.status } });
}

/** Cleans the temp render file of a video (used when a render is retried). */
export async function cleanupTemp(videoId: string): Promise<void> {
  await rm(path.join(paths.videoDir(videoId), "short.tmp.mp4"), { force: true });
}

export function registerPipelineHandlers(): void {
  registerJobHandler("script", (j) => runScriptStep(j.videoId!), markFailed);
  registerJobHandler("assets", (j) => runAssetsStep(j.videoId!), markFailed);
  registerJobHandler(
    "render",
    async (j) => {
      await cleanupTemp(j.videoId!);
      await runRenderStep(j.videoId!);
    },
    markFailed,
  );
}
