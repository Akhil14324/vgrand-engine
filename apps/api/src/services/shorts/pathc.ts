import path from "node:path";
import { writeFile } from "node:fs/promises";
import { Prisma, prisma } from "@catgpt/db";
import type { VideoModelId } from "@catgpt/types";
import { env } from "../../env.js";
import { pollClip, submitClip, type ClipStatus } from "../video-gen/providers.js";
import { checkBudget, clipPrompt, clipSecondsFor, monthStart, PATH_C_RESOLUTION, pricePerSecond, PROVIDER_MODEL, round2 } from "./budget-logic.js";
import type { ShortsChannelRow } from "./channels.js";
import { parseBudget, VIDEO_GEN_PROVIDERS, type VideoGenProvider } from "./env-check-logic.js";
import { ffmpeg, videoInfo } from "./ffmpeg.js";
import { log, recordEvent } from "./log.js";
import type { ShortsVideoRow } from "./videos.js";

/**
 * Path C: short AI-generated clips, one per beat, metered against a hard
 * monthly cap. Before every generation call the cost is estimated and reserved
 * under a Postgres advisory lock (so two workers can't both squeeze under the
 * cap); every spend is written to the cost ledger. Any problem raises
 * PathCFallback and the caller switches the video to Path B.
 */

/** Path C could not run (no provider, budget cap, generation failed): the caller falls back to Path B. */
export class PathCFallback extends Error {
  constructor(
    public reason: "not_configured" | "budget_cap" | "price_unset" | "generation_failed",
    message: string,
  ) {
    super(message);
  }
}

interface ClipGen {
  provider: string;
  model: VideoModelId;
  license: string;
  submit(prompt: string, seconds: number): Promise<string>;
  poll(taskId: string): Promise<ClipStatus>;
  /** Saves a finished clip to `dest`. */
  fetch(status: Extract<ClipStatus, { state: "done" }>, taskId: string, seconds: number, dest: string): Promise<void>;
  pollMs: number;
}

function liveGen(): ClipGen {
  const p = env.VIDEO_GEN_PROVIDER?.trim().toLowerCase() as VideoGenProvider | undefined;
  if (!p || !env.VIDEO_GEN_API_KEY || !(VIDEO_GEN_PROVIDERS as readonly string[]).includes(p)) {
    throw new PathCFallback("not_configured", "VIDEO_GEN_PROVIDER / VIDEO_GEN_API_KEY not configured");
  }
  const model = PROVIDER_MODEL[p];
  const key = env.VIDEO_GEN_API_KEY;
  return {
    provider: p,
    model,
    license: `AI-generated with ${p} (${model}); used under the provider's terms for generated output`,
    pollMs: 10_000,
    submit: (prompt, seconds) => submitClip({ model, prompt, durationSec: seconds, width: 720, height: 1280, resolution: PATH_C_RESOLUTION }, key),
    poll: (taskId) => pollClip(model, taskId, key),
    async fetch(status, _taskId, _seconds, dest) {
      const res = await fetch(status.url, { headers: status.headers, signal: AbortSignal.timeout(5 * 60_000) });
      if (!res.ok) throw new Error(`clip download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 1000 || buf.byteLength > 200 * 1024 * 1024) throw new Error("generated clip has an unexpected size");
      await writeFile(dest, buf);
    },
  };
}

/** Dry runs: a local stand-in that renders a test clip, so the budget/fallback logic runs without spend. */
const offlineGen: ClipGen = {
  provider: "offline_clipgen",
  model: "veo-3.1-lite",
  license: "Generated test clip (offline dry run)",
  pollMs: 10,
  submit: async (_p, seconds) => `offline-${Date.now()}-${seconds}`,
  poll: async () => ({ state: "done", url: "offline://clip" }),
  async fetch(_s, taskId, seconds, dest) {
    const hue = parseInt(taskId.slice(-3), 10) % 360;
    const r = await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `mandelbrot=size=720x1280:rate=30,hue=h=${hue}`, "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", dest]);
    if (r.code !== 0) throw new Error(`offline clip failed: ${r.stderr.slice(-200)}`);
  },
};

/* ---------------------------------- ledger ---------------------------------- */

export async function monthSpend(): Promise<number> {
  const r = await prisma.shortsCost.aggregate({
    where: { status: { in: ["reserved", "spent"] }, createdAt: { gte: monthStart(new Date(), env.TIMEZONE) } },
    _sum: { cost: true },
  });
  return round2(r._sum.cost ?? 0);
}

/** Reserves `estimate` against the monthly cap atomically. Returns the ledger row id, or null when over the cap. */
async function reserve(input: { videoId: string; channelId: string; provider: string; seconds: number; estimate: number; budget: number; currency: string; beatIndex: number }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shorts-pathc-budget'))`;
    const agg = await tx.shortsCost.aggregate({
      where: { status: { in: ["reserved", "spent"] }, createdAt: { gte: monthStart(new Date(), env.TIMEZONE) } },
      _sum: { cost: true },
    });
    const check = checkBudget(input.budget, agg._sum.cost ?? 0, input.estimate);
    if (!check.ok) return { row: null, check };
    const row = await tx.shortsCost.create({
      data: {
        videoId: input.videoId,
        channelId: input.channelId,
        provider: input.provider,
        units: input.seconds,
        unitLabel: "seconds",
        cost: input.estimate,
        currency: input.currency,
        status: "reserved",
        note: JSON.stringify({ beatIndex: input.beatIndex }),
      },
    });
    return { row, check };
  });
}

/* ---------------------------------- generate --------------------------------- */

interface Beat {
  narration: string;
  queries?: string[];
  startSec: number;
  endSec: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generateClipsForVideo(video: ShortsVideoRow, channel: ShortsChannelRow, beats: Beat[], dir: string): Promise<void> {
  const gen = video.source === "dry_run" ? offlineGen : liveGen();
  const budget = parseBudget(env.PATH_C_MONTHLY_BUDGET);
  const currency = (env.BUDGET_CURRENCY ?? "").toUpperCase();
  if (budget === null || !currency) throw new PathCFallback("not_configured", "PATH_C_MONTHLY_BUDGET / BUDGET_CURRENCY not set");
  const settings = await prisma.shortsSettings.findUnique({ where: { userId: channel.userId } });
  const price =
    gen.provider === "offline_clipgen"
      ? (settings?.pathCPricePerSecond ?? 0.05)
      : pricePerSecond({ setting: settings?.pathCPricePerSecond ?? null, currency, model: gen.model });
  if (price === null) {
    throw new PathCFallback("price_unset", `No price per second set for ${currency}. Set it on the Costs page (built-in prices are USD only).`);
  }

  for (let i = 0; i < beats.length; i++) {
    const done = await prisma.shortsAsset.findFirst({ where: { videoId: video.id, kind: "generated_clip", beatIndex: i } });
    if (done?.localPath) continue; // made by an earlier attempt

    const b = beats[i]!;
    const seconds = clipSecondsFor(gen.model, b.endSec - b.startSec);
    const prompt = clipPrompt({ niche: channel.niche, queries: b.queries ?? [], narration: b.narration });

    // A crash after submit leaves a spent ledger row with the task id: resume that task, never pay twice.
    const prior = (await prisma.shortsCost.findMany({ where: { videoId: video.id, status: "spent" } })).find((c) => {
      const n = JSON.parse(c.note ?? "{}") as { beatIndex?: number; taskId?: string };
      return n.beatIndex === i && n.taskId;
    });
    let taskId = prior ? (JSON.parse(prior.note!) as { taskId: string }).taskId : null;
    let ledgerId = prior?.id ?? null;

    if (!taskId) {
      const estimate = round2(seconds * price);
      const { row, check } = await reserve({ videoId: video.id, channelId: channel.id, provider: gen.provider, seconds, estimate, budget, currency, beatIndex: i });
      if (!row) {
        throw new PathCFallback(
          "budget_cap",
          `Monthly Path C budget reached: ${check.spent} of ${budget} ${currency} spent, ${check.remaining} left, next clip needs ${check.estimate}`,
        );
      }
      ledgerId = row.id;
      try {
        taskId = await gen.submit(prompt, seconds);
      } catch (err) {
        // Never accepted by the provider: nothing was spent.
        await prisma.shortsCost.update({ where: { id: row.id }, data: { status: "released", note: JSON.stringify({ beatIndex: i, error: String(err).slice(0, 300) }) } });
        throw new PathCFallback("generation_failed", `Clip request for beat ${i} failed: ${err instanceof Error ? err.message : err}`);
      }
      await prisma.shortsCost.update({ where: { id: row.id }, data: { status: "spent", note: JSON.stringify({ beatIndex: i, taskId, model: gen.model, prompt }) } });
      log.info("pathc.spend", { videoId: video.id, provider: gen.provider, seconds, cost: estimate, currency });
    }

    const deadline = Date.now() + 10 * 60_000;
    let status: ClipStatus;
    for (;;) {
      status = await gen.poll(taskId!);
      if (status.state !== "running") break;
      if (Date.now() > deadline) throw new PathCFallback("generation_failed", `Clip for beat ${i} took longer than 10 minutes`);
      await sleep(gen.pollMs);
    }
    if (status.state === "failed") throw new PathCFallback("generation_failed", `Provider could not make the clip for beat ${i}: ${status.message}`);
    const file = path.join(dir, `gen-${i}.mp4`);
    await gen.fetch(status, taskId!, seconds, file);
    const info = await videoInfo(file);
    await prisma.shortsAsset.create({
      data: {
        videoId: video.id,
        kind: "generated_clip",
        provider: gen.provider,
        providerAssetId: taskId,
        license: gen.license,
        beatIndex: i,
        localPath: file,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        meta: { prompt, model: gen.model, seconds, ledgerId } as Prisma.InputJsonValue,
      },
    });
  }
  await recordEvent({ videoId: video.id, channelId: channel.id, type: "pathc.generated", message: `Generated ${beats.length} clip(s) with ${gen.provider}` });
}

/** Budget summary for the Costs page. */
export async function pathCBudgetStatus(userId: string) {
  const budget = parseBudget(env.PATH_C_MONTHLY_BUDGET);
  const currency = (env.BUDGET_CURRENCY ?? "").toUpperCase() || null;
  const spent = await monthSpend();
  const settings = await prisma.shortsSettings.findUnique({ where: { userId } });
  const p = env.VIDEO_GEN_PROVIDER?.trim().toLowerCase() as VideoGenProvider | undefined;
  const model = p && p in PROVIDER_MODEL ? PROVIDER_MODEL[p] : null;
  return {
    budget,
    currency,
    spent,
    remaining: budget === null ? null : round2(Math.max(0, budget - spent)),
    provider: p ?? null,
    model,
    pricePerSecond: model ? pricePerSecond({ setting: settings?.pathCPricePerSecond ?? null, currency, model }) : (settings?.pathCPricePerSecond ?? null),
    priceIsOwnerSet: settings?.pathCPricePerSecond !== null && settings?.pathCPricePerSecond !== undefined,
  };
}
