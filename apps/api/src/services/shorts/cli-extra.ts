import { drainJobs } from "./jobs.js";
import { scanIngestFolders } from "./ingest.js";
import { prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { GENERATION_HORIZON_MS, generationTick } from "./scheduler.js";
import { expectedSlots } from "./scheduler-logic.js";
import { addDays, localDate, zonedToUtc } from "./schedule-logic.js";

type Ctx = { arg: (n: string) => string | undefined; flag: (n: string) => boolean; resolveOwner: () => Promise<string> };

/** CLI commands beyond check/seed/make/drain. Returns null when `cmd` is unknown. */
export async function runCliExtra(cmd: string | undefined, ctx: Ctx): Promise<number | null> {
  switch (cmd) {
    case "ingest": {
      // Scan the Path A watch folders now (no 30 s stability wait) and process what was found.
      const userId = await ctx.resolveOwner();
      const r = await scanIngestFolders({ userId, ignoreStability: true });
      console.log(`queued ${r.queued}; rejected ${r.skipped.length ? r.skipped.join(", ") : "none"}`);
      await drainJobs({ types: ["ingest"] });
      const recent = await prisma.shortsVideo.findMany({ where: { userId, source: "ingest" }, orderBy: { createdAt: "desc" }, take: Math.max(1, r.queued), include: { channel: { select: { slug: true } } } });
      for (const v of recent) console.log(`  ${v.channel.slug}: "${v.title}" -> ${v.status}, slot ${v.slotAt?.toISOString() ?? "-"}, ${v.durationSec?.toFixed(1)}s`);
      return 0;
    }
    case "dry-run":
      return dryRun(ctx);
    default:
      return null;
  }
}

/**
 * N-day dry run: drives the real scheduler with a simulated clock (hourly ticks)
 * over N full local days starting tomorrow, then runs every created video through
 * the real pipeline on offline fixtures (no API calls, no uploads). Prints expected
 * vs actual videos per channel per day and the final status per approval mode.
 * Dry-run rows stay (source=dry_run, hidden from analytics) unless --cleanup.
 */
async function dryRun(ctx: Ctx): Promise<number> {
  const userId = await ctx.resolveOwner();
  const days = Number(ctx.arg("days") ?? 3);
  const tz = env.TIMEZONE;
  const first = addDays(localDate(new Date(), tz), 1);
  const start = zonedToUtc(first, "00:00", tz);
  const end = zonedToUtc(addDays(first, days), "00:00", tz);
  const runStarted = new Date();

  // Clock: from 24 h before the window (when its first slots enter the horizon) to its end.
  let ticks = 0;
  for (let t = start.getTime() - GENERATION_HORIZON_MS; t < end.getTime(); t += 3600_000) {
    await generationTick(new Date(t), { source: "dry_run", userId, window: { from: start, to: end } });
    ticks++;
  }
  const made = await prisma.shortsVideo.findMany({
    where: { userId, source: "dry_run", createdAt: { gte: runStarted } },
    include: { channel: { select: { slug: true, approvalMode: true } } },
  });
  console.log(`simulated ${ticks} hourly scheduler ticks; ${made.length} dry-run videos created`);

  if (!ctx.flag("no-render")) {
    console.log("running every video through the pipeline on offline fixtures...");
    const ids = made.map((v) => v.id);
    await drainJobs({ videoIds: ids, types: ["script", "assets", "render", "post"], concurrency: Number(ctx.arg("concurrency") ?? 3), max: 10_000 });
  }

  const channels = await prisma.shortsChannel.findMany({ where: { userId } });
  const expected = expectedSlots(channels, first, days, tz);
  const final = await prisma.shortsVideo.findMany({ where: { id: { in: made.map((v) => v.id) } }, include: { channel: { select: { slug: true, approvalMode: true } } } });
  const actual: Record<string, Record<string, number>> = {};
  for (const v of final) {
    const d = localDate(v.slotAt!, tz);
    if (v.slotAt! < start || v.slotAt! >= end) continue;
    actual[v.channel.slug] ??= {};
    actual[v.channel.slug]![d] = (actual[v.channel.slug]![d] ?? 0) + 1;
  }
  const dates = Array.from({ length: days }, (_, i) => addDays(first, i));
  console.log(`\nvideos per channel per day (${tz}), expected/actual:`);
  console.log(["channel".padEnd(18), ...dates.map((d) => d.padEnd(12)), "result"].join(" "));
  let allOk = true;
  for (const c of channels.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const cells = dates.map((d) => {
      const e = expected[c.slug]![d]!;
      const a = actual[c.slug]?.[d] ?? 0;
      if (e !== a) allOk = false;
      return `${e}/${a}`.padEnd(12);
    });
    const ok = dates.every((d) => expected[c.slug]![d] === (actual[c.slug]?.[d] ?? 0));
    console.log([c.slug.padEnd(18), ...cells, ok ? "OK" : "MISMATCH"].join(" "));
  }

  const byMode: Record<string, Record<string, number>> = {};
  for (const v of final) {
    byMode[v.channel.approvalMode] ??= {};
    byMode[v.channel.approvalMode]![v.status] = (byMode[v.channel.approvalMode]![v.status] ?? 0) + 1;
  }
  console.log("\nfinal status by approval mode:", JSON.stringify(byMode));
  const uploaded = final.filter((v) => v.youtubeVideoId).length;
  console.log(`uploads attempted: ${uploaded} (must be 0)`);
  const failed = final.filter((v) => v.status === "failed");
  for (const f of failed.slice(0, 5)) console.log(`  failed ${f.channel.slug}: ${f.error}`);

  if (ctx.flag("cleanup")) {
    await prisma.shortsJob.deleteMany({ where: { videoId: { in: final.map((v) => v.id) } } });
    await prisma.shortsVideo.deleteMany({ where: { id: { in: final.map((v) => v.id) } } });
    console.log("dry-run rows removed");
  }
  return allOk && uploaded === 0 && failed.length === 0 ? 0 : 1;
}
