import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { BrandProfile, ReelQaReport } from "@catgpt/types";
import { env } from "../env.js";
import { parseFfmpegInfo, run } from "./social/media/video.js";
import { ffmpegPath } from "./social/media/youtube-video.js";
import { getClient } from "./chat.js";
import { forbiddenTermsLine } from "./video-script-logic.js";
import {
  evaluateChecks,
  overallQa,
  parseBlackSeconds,
  parseFreezeSeconds,
  parseLoudness,
  type QaCheck,
} from "./video-qa-logic.js";

/** Frames sent to the model for the brand review, spread evenly through the reel. */
const REVIEW_FRAMES = 6;
const FRAME_WIDTH = 360;

export type QaReport = ReelQaReport;

/** Measures the rendered file with ffmpeg and returns the checks. */
export async function analyseReel(
  filePath: string,
  expected: { durationSec: number; width: number; height: number },
): Promise<QaCheck[]> {
  const bin = await ffmpegPath();
  const info = parseFfmpegInfo((await run(bin, ["-hide_banner", "-i", filePath])).stderr);
  if (!info) throw new Error("ffmpeg could not read the rendered reel");

  const loudnessRun = await run(bin, ["-hide_banner", "-i", filePath, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const black = await run(bin, ["-hide_banner", "-i", filePath, "-vf", "blackdetect=d=0.2:pix_th=0.10", "-an", "-f", "null", "-"]);
  const freeze = await run(bin, ["-hide_banner", "-i", filePath, "-vf", "freezedetect=n=-60dB:d=1.5", "-an", "-f", "null", "-"]);

  const loudness = parseLoudness(loudnessRun.stderr);
  return evaluateChecks({
    durationSec: info.durationSec,
    expectedDurationSec: expected.durationSec,
    width: info.width,
    height: info.height,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    hasAudio: info.audioCodec !== null,
    integratedLufs: loudness.integratedLufs,
    truePeakDb: loudness.truePeakDb,
    blackSec: parseBlackSeconds(black.stderr),
    freezeSec: parseFreezeSeconds(freeze.stderr),
  });
}

/**
 * Asks the chat model to look at a few frames against the brand rules. It can
 * only comment on what it sees; it can't approve a reel by itself. Skipped
 * without an OpenAI key, and failure here never blocks the reel.
 */
export async function reviewFrames(
  filePath: string,
  durationSec: number,
  brand: { summary: string; profile: BrandProfile | null },
): Promise<QaReport["review"]> {
  if (!env.OPENAI_API_KEY) return { status: "skipped", notes: [] };
  const workDir = await mkdtemp(path.join(tmpdir(), "review-"));
  try {
    const bin = await ffmpegPath();
    const images: { type: "image_url"; image_url: { url: string } }[] = [];
    for (let i = 0; i < REVIEW_FRAMES; i++) {
      const t = ((i + 0.5) * durationSec) / REVIEW_FRAMES;
      const out = path.join(workDir, `frame-${i}.jpg`);
      const res = await run(bin, [
        "-y", "-hide_banner", "-ss", t.toFixed(2), "-i", filePath,
        "-frames:v", "1", "-vf", `scale=${FRAME_WIDTH}:-2`, "-q:v", "5", out,
      ]);
      if (res.code !== 0) continue;
      const b64 = (await readFile(out)).toString("base64");
      images.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
    }
    if (images.length === 0) return { status: "failed", notes: ["No frames could be read for review."] };

    const forbidden = forbiddenTermsLine(brand.profile);
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You review frames from a short promotional reel. Return JSON only: {"notes": ["..."]}. List only visible problems: unreadable or cut-off text, distorted people or objects, obvious artefacts, anything that clashes with the brand, forbidden claims or words shown on screen. Return an empty list when nothing is wrong. Never invent problems.',
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Brand: ${brand.summary}\nForbidden for this brand: ${forbidden}\nFrames are spread evenly through a ${durationSec}s reel.` },
            ...images,
          ],
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { notes?: unknown };
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((n): n is string => typeof n === "string").slice(0, 8)
      : [];
    return { status: "ok", notes };
  } catch (err) {
    console.error("[video-qa] review failed", err);
    return { status: "failed", notes: [] };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Builds the stored QA report. Analysis failures become a warning, not a failed reel. */
export async function buildQaReport(
  filePath: string,
  expected: { durationSec: number; width: number; height: number },
  brand: { summary: string; profile: BrandProfile | null },
): Promise<QaReport> {
  let checks: QaCheck[];
  try {
    checks = await analyseReel(filePath, expected);
  } catch (err) {
    console.error("[video-qa] analysis failed", err);
    checks = [{ id: "analysis", label: "Checks", status: "warn", detail: "The automatic checks could not run." }];
  }
  const review = await reviewFrames(filePath, expected.durationSec, brand);
  return {
    runAt: new Date().toISOString(),
    status: overallQa(checks),
    checks,
    review,
  };
}
