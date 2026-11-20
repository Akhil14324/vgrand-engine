import { MAX_SHORT_SEC, MIN_SHORT_SEC, OUT_H, OUT_W } from "./compose-logic.js";

/** What ffprobe + volumedetect report about a finished file. */
export interface ProbeResult {
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSec: number | null;
  sizeBytes: number;
  /** dB from volumedetect; -91 means digital silence. */
  meanVolumeDb: number | null;
}

export interface ValidationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
}

export const MIN_FILE_BYTES = 200 * 1024;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;

/**
 * The finished-file checks from the spec: resolution, duration, audio present,
 * captions present, file size. `captionEvents` is how many caption events were
 * burned in; `requireCaptions` is false for Path A ingests (rendered elsewhere).
 */
export function validateOutput(p: ProbeResult, opts: { captionEvents: number; requireCaptions: boolean; minSec?: number; maxSec?: number }): ValidationReport {
  const minSec = opts.minSec ?? MIN_SHORT_SEC;
  const maxSec = opts.maxSec ?? MAX_SHORT_SEC;
  const checks: ValidationCheck[] = [
    {
      name: "resolution",
      ok: p.width === OUT_W && p.height === OUT_H,
      detail: `${p.width ?? "?"}x${p.height ?? "?"} (need ${OUT_W}x${OUT_H})`,
    },
    {
      name: "video_codec",
      ok: p.videoCodec === "h264",
      detail: `${p.videoCodec ?? "none"} (need h264)`,
    },
    {
      name: "duration",
      ok: p.durationSec !== null && p.durationSec >= minSec - 0.25 && p.durationSec <= maxSec + 0.25,
      detail: `${p.durationSec?.toFixed(2) ?? "?"}s (need ${minSec}-${maxSec}s)`,
    },
    {
      name: "audio_present",
      ok: p.audioCodec === "aac" && p.meanVolumeDb !== null && p.meanVolumeDb > -60,
      detail: `${p.audioCodec ?? "no audio stream"}, mean volume ${p.meanVolumeDb ?? "?"} dB (need AAC, not silent)`,
    },
    {
      name: "captions_present",
      ok: !opts.requireCaptions || opts.captionEvents > 0,
      detail: opts.requireCaptions ? `${opts.captionEvents} caption events burned in` : "not required (rendered externally)",
    },
    {
      name: "file_size",
      ok: p.sizeBytes >= MIN_FILE_BYTES && p.sizeBytes <= MAX_FILE_BYTES,
      detail: `${(p.sizeBytes / 1024 / 1024).toFixed(2)} MB (need ${MIN_FILE_BYTES / 1024} KB - ${MAX_FILE_BYTES / 1024 / 1024} MB)`,
    },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

/** Parses `ffprobe -print_format json -show_streams -show_format`. */
export function parseFfprobe(json: unknown, sizeBytes: number): Omit<ProbeResult, "meanVolumeDb"> {
  const j = json as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const d = Number(j.format?.duration);
  return {
    width: v?.width ?? null,
    height: v?.height ?? null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    durationSec: Number.isFinite(d) ? d : null,
    sizeBytes,
  };
}

export function parseMeanVolume(stderr: string): number | null {
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  if (!m) return null;
  return m[1] === "-inf" ? -91 : Number(m[1]);
}

export function failureSummary(r: ValidationReport): string {
  return r.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.name}: ${c.detail}`)
    .join("; ");
}
