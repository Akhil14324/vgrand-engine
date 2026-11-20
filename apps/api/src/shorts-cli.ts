import "dotenv/config";
import { prisma } from "@catgpt/db";
import { ensureSeeded } from "./services/shorts/channels.js";
import { logShortsStartupCheck } from "./services/shorts/env-check.js";
import { drainJobs } from "./services/shorts/jobs.js";
import { createVideo } from "./services/shorts/pipeline.js";
import { registerShortsHandlers } from "./services/shorts/index.js";
import { runCliExtra } from "./services/shorts/cli-extra.js";

/**
 * Shorts Factory CLI. Run from apps/api:
 *   pnpm --filter @catgpt/api shorts check
 *   pnpm --filter @catgpt/api shorts make --channel cats [--user you@example.com] [--offline]
 *   pnpm --filter @catgpt/api shorts drain
 * `--offline` uses local fixtures (no API calls, never uploadable) to exercise the pipeline.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** The owner: --user (email or id), else the single user who owns Shorts channels, else the only user. */
export async function resolveOwner(): Promise<string> {
  const u = arg("user");
  if (u) {
    const row = await prisma.user.findFirst({ where: u.includes("@") ? { email: u } : { id: u } });
    if (!row) throw new Error(`No user ${u}. Sign in to the web app once so the user exists.`);
    return row.id;
  }
  const owners = await prisma.shortsChannel.findMany({ distinct: ["userId"], select: { userId: true } });
  if (owners.length === 1) return owners[0]!.userId;
  const users = await prisma.user.findMany({ take: 2, select: { id: true } });
  if (owners.length === 0 && users.length === 1) return users[0]!.id;
  throw new Error("Several users found: pass --user <email>");
}

async function make(): Promise<number> {
  const slug = arg("channel") ?? "cats";
  const offline = flag("offline");
  const userId = await resolveOwner();
  await ensureSeeded(userId);
  const channel = await prisma.shortsChannel.findUnique({ where: { userId_slug: { userId, slug } } });
  if (!channel) throw new Error(`No channel "${slug}"`);
  const { video } = await createVideo({ channelId: channel.id, source: offline ? "dry_run" : "manual" });
  console.log(`video ${video.id} created on ${slug} (${offline ? "offline fixtures" : "live APIs"}); running pipeline...`);

  // Run this video's jobs in-process until no more are due (retries with backoff are left queued).
  await drainJobs({ videoIds: [video.id], types: ["script", "assets", "render"] });
  const v = await prisma.shortsVideo.findUniqueOrThrow({ where: { id: video.id }, include: { assets: true } });
  console.log(`\nstatus: ${v.status}`);
  if (v.error) console.log(`error: ${v.error}`);
  if (v.filePath) {
    console.log(`file: ${v.filePath}`);
    console.log(`duration: ${v.durationSec?.toFixed(2)}s  ${v.width}x${v.height}  ${((v.fileSizeBytes ?? 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`title: ${v.title}`);
    console.log("validation:");
    for (const c of (v.validation as { checks: { name: string; ok: boolean; detail: string }[] }).checks) {
      console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    }
  }
  console.log("assets and licenses:");
  for (const a of v.assets.sort((x, y) => (x.beatIndex ?? -1) - (y.beatIndex ?? -1))) {
    console.log(`  [${a.kind}${a.beatIndex !== null ? ` beat ${a.beatIndex}` : ""}] ${a.provider} ${a.providerAssetId ?? ""} | ${a.license} | ${a.sourceUrl ?? "-"}`);
  }
  const pending = await prisma.shortsJob.findMany({ where: { videoId: video.id, status: "queued" } });
  for (const j of pending) console.log(`queued for retry: ${j.type} at ${j.runAt.toISOString()} (${j.lastError})`);
  return v.status === "failed" ? 1 : 0;
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  registerShortsHandlers();
  switch (cmd) {
    case "check": {
      const h = await logShortsStartupCheck();
      return h?.ok ? 0 : 1;
    }
    case "seed": {
      const userId = await resolveOwner();
      console.log(`seeded ${await ensureSeeded(userId)} new channel(s) for ${userId}`);
      return 0;
    }
    case "make":
      return make();
    case "drain": {
      // --video <id>: only that video's jobs (used by the crash test).
      const v = arg("video");
      console.log(`ran ${await drainJobs(v ? { videoIds: [v] } : {})} job(s)`);
      return 0;
    }
    default: {
      const handled = await runCliExtra(cmd, { arg, flag, resolveOwner });
      if (handled !== null) return handled;
      console.log("usage: shorts <check|seed|make|drain|dry-run|ingest|sync|report> [--channel slug] [--user email] [--offline]");
      return 2;
    }
  }
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
