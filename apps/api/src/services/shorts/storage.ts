import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../../env.js";
import { decryptWithKey, encryptWithKey } from "../../lib/social-crypto.js";
import { ShortsConfigError } from "./env-check.js";

/** Root for all Shorts media (renders, downloaded assets, ingest folders, music library). */
export const storageRoot = () => path.resolve(env.STORAGE_PATH);

export const paths = {
  videoDir: (videoId: string) => path.join(storageRoot(), "videos", videoId),
  ingestDir: (slug: string) => path.join(storageRoot(), "ingest", slug),
  ingestDone: (slug: string) => path.join(storageRoot(), "ingest", slug, "processed"),
  ingestRejected: (slug: string) => path.join(storageRoot(), "ingest", slug, "rejected"),
  musicLibrary: () => path.join(storageRoot(), "music_library"),
};

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** True when `p` resolves inside the storage root (guards against path traversal from DB values). */
export function insideStorage(p: string): boolean {
  const root = storageRoot() + path.sep;
  return path.resolve(p).startsWith(root);
}

/* ------------------------------ token encryption ----------------------------- */

/** 32-byte key from TOKEN_ENCRYPTION_KEY: 64 hex chars as-is, otherwise SHA-256 of the passphrase. */
function tokenKey(): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new ShortsConfigError("TOKEN_ENCRYPTION_KEY is not set");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < 32) throw new ShortsConfigError("TOKEN_ENCRYPTION_KEY must be 64 hex chars or at least 32 characters");
  return createHash("sha256").update(raw, "utf8").digest();
}

export const encryptSecret = (plain: string) => encryptWithKey(plain, tokenKey());
export const decryptSecret = (enc: string) => decryptWithKey(enc, tokenKey(), "TOKEN_ENCRYPTION_KEY");

/* -------------------------------- signed URLs -------------------------------- */

// Signed file URLs: derived from TOKEN_ENCRYPTION_KEY when set; otherwise a per-process
// random secret (links then stop working after a restart, which is acceptable).
let signingSecret: Buffer | null = null;
function signer(): Buffer {
  if (!signingSecret) {
    signingSecret = env.TOKEN_ENCRYPTION_KEY
      ? createHmac("sha256", env.TOKEN_ENCRYPTION_KEY).update("shorts-file-url").digest()
      : randomBytes(32);
  }
  return signingSecret;
}

export function signFile(videoId: string, exp: number): string {
  return createHmac("sha256", signer()).update(`${videoId}.${exp}`).digest("base64url");
}

export function verifyFileSignature(videoId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(signFile(videoId, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** API URL for the rendered MP4, valid for `ttlSec`. */
export function signedFileUrl(videoId: string, ttlSec = 6 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/shorts/files/${videoId}.mp4?exp=${exp}&sig=${signFile(videoId, exp)}`;
}
