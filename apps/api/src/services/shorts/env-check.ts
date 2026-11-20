import { spawn } from "node:child_process";
import type { ShortsHealthDto } from "@catgpt/types";
import { env } from "../../env.js";
import { checkShortsEnv, formatHealthReport } from "./env-check-logic.js";

/** Runs `<bin> -version`; true when it exits 0. */
function toolRuns(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(bin, ["-version"], { stdio: "ignore" });
      const t = setTimeout(() => {
        p.kill("SIGKILL");
        resolve(false);
      }, 10_000);
      p.on("error", () => {
        clearTimeout(t);
        resolve(false);
      });
      p.on("close", (code) => {
        clearTimeout(t);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

export const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
export const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";

let cached: { at: number; value: ShortsHealthDto } | null = null;

export async function shortsHealth(force = false): Promise<ShortsHealthDto> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.value;
  const [ffmpeg, ffprobe] = await Promise.all([toolRuns(FFMPEG_BIN), toolRuns(FFPROBE_BIN)]);
  const value = checkShortsEnv(
    {
      ...env,
      ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY,
      // TIMEZONE/STORAGE_PATH have defaults in env.ts; report the raw values.
      TIMEZONE: process.env.TIMEZONE,
      STORAGE_PATH: process.env.STORAGE_PATH,
    },
    { ffmpeg, ffprobe },
  );
  cached = { at: Date.now(), value };
  return value;
}

/** Printed at boot by the API and the worker. Never throws. */
export async function logShortsStartupCheck(): Promise<ShortsHealthDto | null> {
  try {
    const h = await shortsHealth(true);
    const text = formatHealthReport(h);
    if (h.ok) console.log(text);
    else console.error(text);
    return h;
  } catch (err) {
    console.error("[shorts] startup check itself failed:", err);
    return null;
  }
}

/** Thrown by a feature whose configuration is missing. The message names what to set. */
export class ShortsConfigError extends Error {}

export function requireEnv<K extends keyof typeof env>(...keys: K[]): void {
  const missing = keys.filter((k) => {
    const v = env[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length) throw new ShortsConfigError(`Not configured: set ${missing.join(", ")}`);
}
