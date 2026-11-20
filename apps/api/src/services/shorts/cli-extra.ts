import { drainJobs } from "./jobs.js";
import { scanIngestFolders } from "./ingest.js";
import { prisma } from "@catgpt/db";

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
    default:
      return null;
  }
}
