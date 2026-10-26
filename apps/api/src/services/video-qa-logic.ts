/**
 * Pure QA rules for a rendered reel (phase 7): parse ffmpeg's analysis output,
 * then turn the numbers into pass / warn / fail checks. No I/O here.
 */

import type { ReelQaCheck, ReelQaStatus } from "@catgpt/types";

export type QaCheck = ReelQaCheck;
export type QaStatus = ReelQaStatus;

/** Platform loudness target and tolerance (LUFS). The render normalises to -16. */
export const LOUDNESS_TARGET_LUFS = -16;
export const LOUDNESS_TOLERANCE_LU = 2;

/** Black or frozen stretches longer than this (seconds, in total) are flagged. */
export const BLACK_WARN_SEC = 0.5;
export const BLACK_FAIL_SEC = 1.5;
export const FREEZE_WARN_SEC = 1.5;

/** Loudness summary from `ebur128=peak=true`: the last integrated value and true peak printed. */
export function parseLoudness(stderr: string): { integratedLufs: number | null; truePeakDb: number | null } {
  const integrated = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)].pop();
  const peak = [...stderr.matchAll(/Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/g)].pop();
  return {
    integratedLufs: integrated ? Number(integrated[1]) : null,
    truePeakDb: peak ? Number(peak[1]) : null,
  };
}

/** Total seconds reported by `blackdetect` (one line per black stretch). */
export function parseBlackSeconds(stderr: string): number {
  return [...stderr.matchAll(/black_duration:\s*(\d+(?:\.\d+)?)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
}

/** Total seconds reported by `freezedetect`. */
export function parseFreezeSeconds(stderr: string): number {
  return [...stderr.matchAll(/freeze_duration:\s*(\d+(?:\.\d+)?)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
}

export interface QaMetrics {
  durationSec: number;
  expectedDurationSec: number;
  width: number;
  height: number;
  expectedWidth: number;
  expectedHeight: number;
  hasAudio: boolean;
  integratedLufs: number | null;
  truePeakDb: number | null;
  blackSec: number;
  freezeSec: number;
}

/** Turns the measured numbers into the checks shown to the user. */
export function evaluateChecks(m: QaMetrics): QaCheck[] {
  const checks: QaCheck[] = [];

  const drift = Math.abs(m.durationSec - m.expectedDurationSec);
  checks.push({
    id: "duration",
    label: "Length",
    status: drift <= 0.5 ? "pass" : drift <= 1 ? "warn" : "fail",
    detail: `${m.durationSec.toFixed(1)}s (asked for ${m.expectedDurationSec}s)`,
  });

  const sizeOk = m.width === m.expectedWidth && m.height === m.expectedHeight;
  checks.push({
    id: "frame",
    label: "Frame size",
    status: sizeOk ? "pass" : "fail",
    detail: `${m.width}×${m.height} (expected ${m.expectedWidth}×${m.expectedHeight})`,
  });

  checks.push({
    id: "audio",
    label: "Sound",
    status: m.hasAudio ? "pass" : "warn",
    detail: m.hasAudio ? "Audio track present" : "No audio track in the reel",
  });

  if (m.integratedLufs === null) {
    checks.push({ id: "loudness", label: "Loudness", status: "warn", detail: "Could not measure loudness" });
  } else {
    const off = Math.abs(m.integratedLufs - LOUDNESS_TARGET_LUFS);
    checks.push({
      id: "loudness",
      label: "Loudness",
      status: off <= LOUDNESS_TOLERANCE_LU ? "pass" : "warn",
      detail: `${m.integratedLufs.toFixed(1)} LUFS (target ${LOUDNESS_TARGET_LUFS})`,
    });
  }

  if (m.truePeakDb !== null) {
    checks.push({
      id: "peak",
      label: "Clipping",
      status: m.truePeakDb <= -1 ? "pass" : "fail",
      detail: `Peak ${m.truePeakDb.toFixed(1)} dBTP`,
    });
  }

  checks.push({
    id: "black",
    label: "Black frames",
    status: m.blackSec >= BLACK_FAIL_SEC ? "fail" : m.blackSec >= BLACK_WARN_SEC ? "warn" : "pass",
    detail: m.blackSec > 0 ? `${m.blackSec.toFixed(1)}s of black` : "None",
  });

  checks.push({
    id: "freeze",
    label: "Frozen frames",
    status: m.freezeSec >= FREEZE_WARN_SEC ? "warn" : "pass",
    detail: m.freezeSec > 0 ? `${m.freezeSec.toFixed(1)}s frozen` : "None",
  });

  return checks;
}

/** A reel passes when no check failed. Warnings are shown but don't block approval. */
export function overallQa(checks: QaCheck[]): QaStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}
