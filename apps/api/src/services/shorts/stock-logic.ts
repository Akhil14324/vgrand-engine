import { createHash } from "node:crypto";

/**
 * Stock footage from Pexels and Pixabay only (content rule). Parses their API
 * responses, filters to clips that can fill a 1080x1920 frame, and picks one
 * clip per beat while varying footage across videos.
 */

export type StockProvider = "pexels" | "pixabay";

export interface StockCandidate {
  provider: StockProvider | "offline_fixture";
  id: string;
  pageUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSec: number;
  author: string | null;
  authorUrl: string | null;
  license: string;
  licenseUrl: string;
}

export const LICENSES = {
  pexels: { license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" },
  pixabay: { license: "Pixabay Content License", licenseUrl: "https://pixabay.com/service/license-summary/" },
} as const;

/** Hosts a stock clip may be downloaded from. Anything else is refused. */
const ALLOWED_DOWNLOAD_HOSTS = [/(^|\.)pexels\.com$/i, /(^|\.)pixabay\.com$/i, /(^|\.)vimeo\.com$/i];
/** Never download from these, whatever an API returns. */
const FORBIDDEN_HOSTS = [/(^|\.)youtube\.com$/i, /(^|\.)youtu\.be$/i, /(^|\.)googlevideo\.com$/i, /(^|\.)instagram\.com$/i, /(^|\.)cdninstagram\.com$/i, /(^|\.)tiktok\.com$/i, /(^|\.)tiktokcdn\.com$/i];

export function isAllowedStockUrl(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname;
  } catch {
    return false;
  }
  if (FORBIDDEN_HOSTS.some((r) => r.test(host))) return false;
  return ALLOWED_DOWNLOAD_HOSTS.some((r) => r.test(host));
}

/* --------------------------------- parsing --------------------------------- */

interface PexelsVideo {
  id?: number;
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  user?: { name?: string; url?: string };
  video_files?: { quality?: string | null; file_type?: string; width?: number | null; height?: number | null; link?: string }[];
}

/** Best MP4 rendition of a Pexels video: smallest file that is at least 1080 on its short side, else the largest. */
export function parsePexels(json: { videos?: PexelsVideo[] }): StockCandidate[] {
  const out: StockCandidate[] = [];
  for (const v of json.videos ?? []) {
    if (!v.id || !v.url || !v.duration) continue;
    const files = (v.video_files ?? []).filter(
      (f): f is Required<Pick<NonNullable<PexelsVideo["video_files"]>[number], "link">> & { width: number; height: number; file_type?: string } =>
        !!f.link && f.file_type === "video/mp4" && !!f.width && !!f.height,
    );
    if (!files.length) continue;
    const big = files.filter((f) => Math.min(f.width, f.height) >= 1080).sort((a, b) => a.width * a.height - b.width * b.height);
    const pick = big[0] ?? files.sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
    if (!isAllowedStockUrl(pick.link)) continue;
    out.push({
      provider: "pexels",
      id: String(v.id),
      pageUrl: v.url,
      downloadUrl: pick.link,
      width: pick.width,
      height: pick.height,
      durationSec: v.duration,
      author: v.user?.name ?? null,
      authorUrl: v.user?.url ?? null,
      ...LICENSES.pexels,
    });
  }
  return out;
}

interface PixabayRendition {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
}
interface PixabayHit {
  id?: number;
  pageURL?: string;
  duration?: number;
  user?: string;
  user_id?: number;
  videos?: Partial<Record<"large" | "medium" | "small" | "tiny", PixabayRendition>>;
}

export function parsePixabay(json: { hits?: PixabayHit[] }): StockCandidate[] {
  const out: StockCandidate[] = [];
  for (const h of json.hits ?? []) {
    if (!h.id || !h.pageURL || !h.duration) continue;
    // `large` can be an empty URL with size 0.
    const r = [h.videos?.large, h.videos?.medium].find((x) => x?.url && x.width && x.height && (x.size ?? 1) > 0);
    if (!r?.url || !isAllowedStockUrl(r.url)) continue;
    out.push({
      provider: "pixabay",
      id: String(h.id),
      pageUrl: h.pageURL,
      downloadUrl: r.url,
      width: r.width!,
      height: r.height!,
      durationSec: h.duration,
      author: h.user ?? null,
      authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : null,
      ...LICENSES.pixabay,
    });
  }
  return out;
}

/* ----------------------------- filter and score ----------------------------- */

/**
 * Vertical, or croppable: a center 9:16 crop must still be at least 540 px wide
 * before upscaling (so no worse than 2x upscale), and the clip at least 2 s long.
 */
export function isUsable(c: Pick<StockCandidate, "width" | "height" | "durationSec">): boolean {
  if (c.durationSec < 2) return false;
  const cropWidth = c.width >= c.height * (9 / 16) ? c.height * (9 / 16) : c.width;
  return cropWidth >= 540 && c.height >= 960;
}

export function score(c: StockCandidate, neededSec: number): number {
  let s = 0;
  if (c.height > c.width) s += 50; // native vertical: no crop
  s += Math.min(c.height, 1920) / 100; // resolution, up to +19
  if (c.durationSec >= neededSec + 0.5) s += 20; // no looping needed
  return s;
}

export interface BeatNeed {
  index: number;
  neededSec: number;
  candidates: StockCandidate[];
}

export interface PickedClip {
  beatIndex: number;
  clip: StockCandidate;
  reused: boolean;
}

/**
 * One clip per beat. A clip is never used twice in the same video, and clips the
 * channel used in the last 30 days are only taken when nothing fresh fits.
 * Returns null for a beat with no usable candidate.
 */
export function pickClips(beats: BeatNeed[], recentlyUsed: Set<string>): (PickedClip | null)[] {
  const usedHere = new Set<string>();
  return beats.map((b) => {
    const usable = b.candidates.filter((c) => isUsable(c) && !usedHere.has(keyOf(c)));
    const ranked = usable
      .map((c) => ({ c, s: score(c, b.neededSec) - (recentlyUsed.has(keyOf(c)) ? 100 : 0) }))
      .sort((a, z) => z.s - a.s);
    const best = ranked[0]?.c;
    if (!best) return null;
    usedHere.add(keyOf(best));
    return { beatIndex: b.index, clip: best, reused: recentlyUsed.has(keyOf(best)) };
  });
}

export const keyOf = (c: Pick<StockCandidate, "provider" | "id">) => `${c.provider}:${c.id}`;

/** Order-independent identity of a video's footage set. */
export function footageHash(keys: string[]): string {
  return createHash("sha256").update([...keys].sort().join("|")).digest("hex");
}

/** Interleaves results from both providers so neither dominates. */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== undefined) out.push(a[i]!);
    if (b[i] !== undefined) out.push(b[i]!);
  }
  return out;
}
