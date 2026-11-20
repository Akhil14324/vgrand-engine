/**
 * Content rules from the spec, enforced in code before a video is composed or
 * accepted. Each returns a list of violations; empty means allowed.
 */

export interface AssetLike {
  kind: string;
  provider: string;
  sourceUrl: string | null;
  license: string;
  localPath: string | null;
}

export const STOCK_PROVIDERS = ["pexels", "pixabay"] as const;
/** Minimum spoken words for "original value" in a Path B video. */
export const MIN_ORIGINAL_WORDS = 20;
export const DUPLICATE_WINDOW_DAYS = 30;

const SCRAPED_SOURCE = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com)/i;

export function pathBViolations(input: {
  narration: string | null;
  assets: AssetLike[];
  /** Dry-run videos may use offline fixtures instead of Pexels/Pixabay. */
  dryRun: boolean;
}): string[] {
  const v: string[] = [];
  const words = (input.narration ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words < MIN_ORIGINAL_WORDS) {
    v.push(`no original script: ${words} narrated words (min ${MIN_ORIGINAL_WORDS}); stock footage plus music alone is not allowed`);
  }
  if (!input.assets.some((a) => a.kind === "voiceover" && a.localPath)) {
    v.push("no voiceover: a Path B video must carry an original voiceover");
  }
  const stock = input.assets.filter((a) => a.kind === "stock_video");
  if (stock.length === 0) v.push("no footage");
  for (const a of stock) {
    const okProvider = (STOCK_PROVIDERS as readonly string[]).includes(a.provider) || (input.dryRun && a.provider === "offline_fixture");
    if (!okProvider) v.push(`footage from "${a.provider}" is not allowed (Pexels and Pixabay only)`);
    if (!a.sourceUrl || !a.license) v.push(`footage asset missing source URL or license record`);
    if (a.sourceUrl && SCRAPED_SOURCE.test(a.sourceUrl)) v.push(`footage from a social platform is not allowed: ${a.sourceUrl}`);
  }
  for (const a of input.assets.filter((x) => x.kind === "music")) {
    if (a.provider !== "music_library") v.push("music must come from the owner-cleared music_library");
  }
  return v;
}

/** A source file offered for ingest must not come from a social platform download. */
export function ingestViolations(input: { fileName: string; sidecarSource?: string | null }): string[] {
  const v: string[] = [];
  if (input.sidecarSource && SCRAPED_SOURCE.test(input.sidecarSource)) {
    v.push("sidecar says the file came from a social platform; reposting other people's videos is not allowed");
  }
  if (!/\.mp4$/i.test(input.fileName)) v.push("only .mp4 files are ingested");
  return v;
}
