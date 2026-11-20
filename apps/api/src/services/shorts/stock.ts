import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../../env.js";
import { log } from "./log.js";
import { interleave, isAllowedStockUrl, parsePexels, parsePixabay, type StockCandidate } from "./stock-logic.js";

/**
 * Pexels and Pixabay video search via their official APIs, with per-provider
 * rate limiting and the 24-hour response cache Pixabay's terms require.
 * Clips are downloaded and stored locally (no hotlinking).
 */

const DAY_MS = 24 * 60 * 60_000;
const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;

/** Sliding-window limiter: at most `max` calls per `windowMs`; waits when full. */
class Limiter {
  private stamps: number[] = [];
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      const wait = this.windowMs - (now - this.stamps[0]!) + 50;
      if (wait > 5 * 60_000) throw new Error("stock API rate limit reached; retry later");
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Documented defaults: Pexels 200/hour, Pixabay 100/minute. Stay a little under.
const limiters = { pexels: new Limiter(190, 60 * 60_000), pixabay: new Limiter(90, 60_000) };
const cache = new Map<string, { at: number; value: StockCandidate[] }>();

async function cached(key: string, fetcher: () => Promise<StockCandidate[]>): Promise<StockCandidate[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.value;
  const value = await fetcher();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 500);
    for (const [k] of oldest) cache.delete(k);
  }
  return value;
}

async function getJson(url: string, headers: Record<string, string>, label: string): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (res.status === 429) throw new Error(`${label} rate limit reached (429); will retry`);
  if (!res.ok) throw new Error(`${label} search failed (${res.status})`);
  return res.json();
}

export async function searchPexels(query: string): Promise<StockCandidate[]> {
  if (!env.PEXELS_API_KEY) return [];
  return cached(`pexels:${query}`, async () => {
    await limiters.pexels.take();
    const u = new URL("https://api.pexels.com/v1/videos/search");
    u.searchParams.set("query", query);
    u.searchParams.set("orientation", "portrait");
    u.searchParams.set("size", "medium");
    u.searchParams.set("per_page", "20");
    return parsePexels((await getJson(u.toString(), { Authorization: env.PEXELS_API_KEY! }, "Pexels")) as never);
  });
}

export async function searchPixabay(query: string): Promise<StockCandidate[]> {
  if (!env.PIXABAY_API_KEY) return [];
  return cached(`pixabay:${query}`, async () => {
    await limiters.pixabay.take();
    const u = new URL("https://pixabay.com/api/videos/");
    u.searchParams.set("key", env.PIXABAY_API_KEY!);
    u.searchParams.set("q", query.slice(0, 100));
    u.searchParams.set("per_page", "20");
    u.searchParams.set("safesearch", "true");
    u.searchParams.set("video_type", "film");
    return parsePixabay((await getJson(u.toString(), {}, "Pixabay")) as never);
  });
}

/** Both providers for one query, interleaved. One provider failing doesn't sink the search. */
export async function searchStock(query: string): Promise<StockCandidate[]> {
  const [a, b] = await Promise.allSettled([searchPexels(query), searchPixabay(query)]);
  for (const r of [a, b]) if (r.status === "rejected") log.warn("stock.search_failed", { query, error: String(r.reason) });
  if (a.status === "rejected" && b.status === "rejected") throw a.reason;
  return interleave(a.status === "fulfilled" ? a.value : [], b.status === "fulfilled" ? b.value : []);
}

/** Streams a stock clip to `dest` (via a temp file). Refuses any host that isn't Pexels/Pixabay. */
export async function downloadStock(url: string, dest: string): Promise<void> {
  if (!isAllowedStockUrl(url)) throw new Error(`refusing to download from a non-stock host: ${new URL(url).hostname}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000), redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`stock download failed (${res.status})`);
  if (res.url && !isAllowedStockUrl(res.url)) throw new Error("stock download redirected to a non-stock host");
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error("stock clip is too large");
  const tmp = `${dest}.part`;
  let bytes = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (c: Buffer) => {
    bytes += c.length;
    if (bytes > MAX_DOWNLOAD_BYTES) body.destroy(new Error("stock clip is too large"));
  });
  try {
    await pipeline(body, createWriteStream(tmp));
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
