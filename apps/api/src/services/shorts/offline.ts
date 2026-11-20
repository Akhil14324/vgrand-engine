import { createHash } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { evenWordTimings } from "./captions-logic.js";
import { ffmpeg, mediaDuration } from "./ffmpeg.js";
import type { ShortsProviders } from "./providers.js";
import { storageRoot } from "./storage.js";
import { WORDS_PER_SECOND } from "./script-logic.js";
import type { StockCandidate } from "./stock-logic.js";

/**
 * Offline fixtures for dry runs and tests: no network, no API keys, no cost.
 * Footage is an ffmpeg test pattern, the "voice" is a synthetic tone with
 * evenly spaced word timings, and the script is assembled from templates.
 * Output is clearly not publishable; dry-run videos are never uploaded.
 */

const h = (s: string) => createHash("sha256").update(s).digest("hex");

const FACTS = [
  "spends a surprising part of the day doing exactly this",
  "uses this trick to stay cool when it gets hot",
  "can tell the difference in a way most people never notice",
  "learned this behaviour long before we started watching",
  "repeats this small routine almost every single morning",
  "relies on this more than on its eyesight",
];

/** A deterministic, varied script for a dry-run video (unique per seed). */
export function offlineScript(niche: string, seed: string) {
  const n = parseInt(h(seed).slice(0, 8), 16);
  const pick = (i: number) => FACTS[(n + i) % FACTS.length]!;
  const beats = [0, 1, 2].map((i) => ({
    narration: `Here is something about ${niche}: it ${pick(i)}, and once you see it you will spot it everywhere you look, test number ${n % 9973}.`,
    searchQueries: [`${niche} ${i}`],
  }));
  return {
    topic: `${niche} habit ${n % 100}`,
    hookType: "shock_fact",
    hook: `Nobody tells you this about ${niche.split(" ")[0]}.`,
    beats,
    title: `Dry run ${niche} fact ${n % 9973}`.slice(0, 60),
    description: "Offline dry-run fixture. Not for publishing.",
    tags: ["dry run", niche, "shorts"],
  };
}

const fixturesDir = () => path.join(storageRoot(), "fixtures");

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

export const offlineProviders: ShortsProviders = {
  name: "offline",
  async script(prompt) {
    const niche = /niche: ([^)]+)\)/.exec(prompt.system)?.[1] ?? "things";
    const seed = prompt.user + Date.now() + Math.random();
    const out = offlineScript(niche, seed);
    return { request: { offline: true, ...prompt }, response: { offline: true, output: out }, text: JSON.stringify(out), parsed: out };
  },
  async searchStock(query) {
    // Mix of native vertical and landscape (croppable) fixtures.
    return [0, 1, 2, 3].map(
      (i): StockCandidate => ({
        provider: "offline_fixture",
        id: h(`${query}:${i}`).slice(0, 12),
        pageUrl: `offline://fixture/${encodeURIComponent(query)}/${i}`,
        downloadUrl: `offline://fixture/${encodeURIComponent(query)}/${i}`,
        width: i % 2 ? 1920 : 1080,
        height: i % 2 ? 1080 : 1920,
        durationSec: 12,
        author: "ffmpeg testsrc2",
        authorUrl: null,
        license: "Generated test pattern (offline dry run)",
        licenseUrl: "offline://fixture",
      }),
    );
  },
  async downloadStock(c, dest) {
    await mkdir(fixturesDir(), { recursive: true });
    const cachedFile = path.join(fixturesDir(), `${c.id}-${c.width}x${c.height}.mp4`);
    if (!(await exists(cachedFile))) {
      const hue = parseInt(c.id.slice(0, 4), 16) % 360;
      const r = await ffmpeg([
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `testsrc2=size=${c.width}x${c.height}:rate=30:duration=${c.durationSec},hue=h=${hue}`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", cachedFile,
      ]);
      if (r.code !== 0) throw new Error(`fixture render failed: ${r.stderr.slice(-300)}`);
    }
    await copyFile(cachedFile, dest);
  },
  async voice(text, voiceId, destMp3) {
    const words = text.trim().split(/\s+/).length;
    const dur = Math.max(3, words / WORDS_PER_SECOND);
    // Speech-like modulated tone so loudness checks see real audio.
    const r = await ffmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `aevalsrc=0.4*sin(2*PI*(170+50*sin(2*PI*3*t))*t)*(0.55+0.45*sin(2*PI*4*t)):s=44100:d=${dur.toFixed(2)}`,
      "-c:a", "libmp3lame", "-b:a", "128k", destMp3,
    ]);
    if (r.code !== 0) throw new Error(`fixture voice failed: ${r.stderr.slice(-300)}`);
    const actual = await mediaDuration(destMp3);
    return { words: evenWordTimings(text, actual), voiceId, modelId: "offline-tone" };
  },
};
