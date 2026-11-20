import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@catgpt/db";
import { ensureDir, paths } from "./storage.js";

const AUDIO = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;

/** Tracks the owner placed in STORAGE_PATH/music_library (owner-cleared only). */
export async function listMusic(): Promise<string[]> {
  const dir = await ensureDir(paths.musicLibrary());
  const files = await readdir(dir).catch(() => [] as string[]);
  return files.filter((f) => AUDIO.test(f) && !f.startsWith(".")).sort();
}

/**
 * Picks the channel's least-recently-used track. Returns null when the
 * library is empty: the video is then rendered without music.
 */
export async function pickMusic(channelId: string): Promise<{ file: string; path: string } | null> {
  const tracks = await listMusic();
  if (!tracks.length) return null;
  const recent = await prisma.shortsVideo.findMany({
    where: { channelId, musicTrack: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { musicTrack: true },
    take: 200,
  });
  const lastUse = new Map<string, number>();
  recent.forEach((r, i) => {
    if (r.musicTrack && !lastUse.has(r.musicTrack)) lastUse.set(r.musicTrack, i);
  });
  // Never used first, then the one used longest ago.
  const ranked = [...tracks].sort((a, b) => (lastUse.get(b) ?? 1e9) - (lastUse.get(a) ?? 1e9));
  const file = ranked[0]!;
  return { file, path: path.join(paths.musicLibrary(), file) };
}
