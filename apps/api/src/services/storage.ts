import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.js";

/**
 * Generated-image persistence.
 *  - Supabase configured -> uploads to the Storage bucket and returns its
 *    public URL.
 *  - Otherwise -> writes under UPLOAD_DIR and returns a URL served by the
 *    API's /uploads static route. Keeps local dev fully working pre-Supabase.
 */
let supabase: SupabaseClient | null = null;
let bucketEnsured = false;

/**
 * Tolerate a hand-pasted project URL: add a missing scheme and strip trailing
 * slashes or an API suffix (/rest/v1, /storage/v1) — any of those makes the
 * Storage API reject requests with "Invalid path specified in request URL".
 */
function normalizeSupabaseUrl(raw: string): string {
  const url = raw.trim();
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withScheme.replace(/\/(rest|storage|auth)\/v1.*$/i, "").replace(/\/+$/, "");
}

const BUCKET = env.STORAGE_BUCKET.trim();

function getSupabase(): SupabaseClient | null {
  if (!env.supabaseConfigured) return null;
  supabase ??= createClient(
    normalizeSupabaseUrl(env.SUPABASE_URL!),
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return supabase;
}

async function ensureBucket(client: SupabaseClient) {
  if (bucketEnsured) return;
  const { error } = await client.storage.createBucket(BUCKET, {
    public: true,
  });
  // Cache success (or "already exists") only — a transient failure must not
  // poison the flag for the process lifetime, or uploads never retry.
  if (error && !/already exists/i.test(error.message)) {
    console.warn(`storage bucket create: ${error.message}`);
    return;
  }
  bucketEnsured = true;
}

/** Cap on bytes pulled from a provider URL — guards memory, not quota. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

export interface StoreImageInput {
  buffer?: Buffer;
  /** Provider-hosted URL to fetch+rehost (provider URLs often expire). */
  sourceUrl?: string;
  mimeType?: string;
  keyPrefix: string;
  /** Overrides the extension derived from mimeType (e.g. "ttf" for fonts). */
  ext?: string;
}

export async function storeImage(input: StoreImageInput): Promise<string> {
  let buffer = input.buffer;
  let mimeType = input.mimeType;

  if (!buffer && input.sourceUrl) {
    // A hung provider connection would otherwise stall the job until the sweep
    // notices it ~15 min later; cap the body so a bad URL can't exhaust memory.
    const res = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`failed to fetch provider image (${res.status})`);
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_FILE_BYTES) {
      throw new Error("provider image exceeds size limit");
    }
    buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error("provider image exceeds size limit");
    }
    mimeType ??= res.headers.get("content-type") ?? undefined;
  }
  if (!buffer) throw new Error("storeImage: no buffer or sourceUrl");

  const ext = input.ext ?? EXT_BY_MIME[mimeType ?? ""] ?? "png";
  const key = `${input.keyPrefix}/${randomBytes(8).toString("hex")}.${ext}`;

  const client = getSupabase();
  if (client) {
    await ensureBucket(client);
    const { error } = await client.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType: mimeType ?? "image/png" });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    const { data } = client.storage
      .from(BUCKET)
      .getPublicUrl(key);
    return data.publicUrl;
  }

  const filePath = path.join(env.UPLOAD_DIR, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `${env.API_PUBLIC_URL}/uploads/${key}`;
}

/** Generic-byte alias — same store, clearer name for non-image files (PDFs). */
export const storeFile = storeImage;

/**
 * Best-effort removal of objects this service stored. Only URLs we produced
 * are touched — Supabase public-object URLs in our bucket, or /uploads/ links
 * on this API's own origin; anything else (provider URLs, theme assets) is
 * skipped. Never throws: an orphaned file beats a failed delete request.
 */
export async function deleteStoredFiles(
  urls: readonly (string | null | undefined)[],
): Promise<void> {
  const supabasePrefix = env.SUPABASE_URL
    ? `${normalizeSupabaseUrl(env.SUPABASE_URL)}/storage/v1/object/public/${BUCKET}/`
    : null;
  const uploadsPrefix = `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/uploads/`;

  const keys: string[] = [];
  const locals: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    if (supabasePrefix && raw.startsWith(supabasePrefix)) {
      keys.push(decodeURIComponent(raw.slice(supabasePrefix.length)));
    } else if (raw.startsWith(uploadsPrefix)) {
      const rel = raw.slice(uploadsPrefix.length);
      // Defence in depth: stored keys are hex-named, but never unlink outside
      // UPLOAD_DIR if a malformed URL somehow got in.
      if (!rel.includes("..")) locals.push(rel);
    }
  }

  const tasks: Promise<unknown>[] = [];
  const client = getSupabase();
  if (client && keys.length) {
    tasks.push(client.storage.from(BUCKET).remove(keys));
  }
  for (const rel of locals) {
    tasks.push(rm(path.join(env.UPLOAD_DIR, rel), { force: true }));
  }
  for (const r of await Promise.allSettled(tasks)) {
    if (r.status === "rejected") {
      console.warn("storage cleanup failed:", r.reason);
    }
  }
}

/* ------------------------- private object storage ------------------------- */

/**
 * Private objects (consented brand-voice samples). Unlike storeImage these
 * never produce a URL: the bucket is created non-public and callers only ever
 * get back the server-side object key. Locally they live under
 * PRIVATE_UPLOAD_DIR — a separate root from UPLOAD_DIR, whose whole tree is
 * served by the /uploads static route.
 */
const PRIVATE_BUCKET = env.PRIVATE_STORAGE_BUCKET.trim();
let privateBucketEnsured = false;

async function ensurePrivateBucket(client: SupabaseClient) {
  if (privateBucketEnsured) return;
  const { error } = await client.storage.createBucket(PRIVATE_BUCKET, {
    public: false,
  });
  if (error && !/already exists/i.test(error.message)) {
    console.warn(`private storage bucket create: ${error.message}`);
    return;
  }
  privateBucketEnsured = true;
}

/** Keys are server-generated; still guard every use — a tampered row must not
 *  be able to read/unlink outside the private root or hand Supabase a bad key. */
const PRIVATE_KEY_RE = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/;

function assertPrivateKey(key: string) {
  if (
    !PRIVATE_KEY_RE.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.includes("\\")
  ) {
    throw new Error("invalid private storage key");
  }
}

function privateFilePath(key: string): string {
  assertPrivateKey(key);
  const root = path.resolve(env.PRIVATE_UPLOAD_DIR);
  const publicRoot = path.resolve(env.UPLOAD_DIR);
  // The static route serves all of UPLOAD_DIR — a private root inside it
  // (or equal to it) would publish every private object.
  const rel = path.relative(publicRoot, root);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error("PRIVATE_UPLOAD_DIR must be outside UPLOAD_DIR");
  }
  const target = path.resolve(root, key);
  const inside = path.relative(root, target);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error("private key escapes storage root");
  }
  return target;
}

/** Server-side key for a new voice sample — callers never supply one. */
export function newVoiceObjectKey(brandId: string, ext: string): string {
  return `brand-voices/${brandId}/${randomBytes(12).toString("hex")}.${ext}`;
}

export async function putPrivateObject(
  key: string,
  buffer: Buffer,
  contentType: string,
  upsert = false,
): Promise<void> {
  assertPrivateKey(key);
  const client = getSupabase();
  if (client) {
    await ensurePrivateBucket(client);
    const { error } = await client.storage
      .from(PRIVATE_BUCKET)
      .upload(key, buffer, { contentType, upsert });
    if (error) throw new Error("private storage upload failed");
    return;
  }
  const filePath = privateFilePath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

/** Read a private object into memory (voice samples are size-capped). */
export async function readPrivateObject(key: string): Promise<Buffer> {
  assertPrivateKey(key);
  const client = getSupabase();
  if (client) {
    const { data, error } = await client.storage
      .from(PRIVATE_BUCKET)
      .download(key);
    if (error || !data) throw new Error("private storage read failed");
    return Buffer.from(await data.arrayBuffer());
  }
  try {
    return await readFile(privateFilePath(key));
  } catch {
    throw new Error("private storage read failed");
  }
}

/** Idempotent delete — a missing object counts as already gone. */
export async function deletePrivateObject(key: string): Promise<void> {
  assertPrivateKey(key);
  const client = getSupabase();
  if (client) {
    const { error } = await client.storage.from(PRIVATE_BUCKET).remove([key]);
    if (error && !/not found|does not exist/i.test(error.message)) {
      throw new Error("private storage delete failed");
    }
    return;
  }
  try {
    await unlink(privateFilePath(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("private storage delete failed");
    }
  }
}

async function privateObjectsWithPrefix(prefix: string): Promise<string[]> {
  if (
    !/^[a-z0-9][a-z0-9/_-]*\/$/.test(prefix) ||
    prefix.includes("..") ||
    prefix.includes("//") ||
    prefix.includes("\\")
  ) {
    throw new Error("invalid private storage prefix");
  }
  const client = getSupabase();
  if (client) {
    const keys: string[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage
        .from(PRIVATE_BUCKET)
        .list(prefix.slice(0, -1), { limit: 100, offset });
      if (error) throw new Error("private storage listing failed");
      const entries = data ?? [];
      keys.push(
        ...entries
          .filter((entry) => entry.id)
          .map((entry) => `${prefix}${entry.name}`),
      );
      if (entries.length < 100) return keys;
      offset += entries.length;
    }
  }
  const directory = path.dirname(privateFilePath(`${prefix}placeholder.wav`));
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("private storage listing failed");
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${prefix}${entry.name}`);
}

export async function deletePrivateObjectsWithPrefix(prefix: string): Promise<void> {
  const keys = await privateObjectsWithPrefix(prefix);
  const client = getSupabase();
  if (client) {
    for (let i = 0; i < keys.length; i += 100) {
      const { error } = await client.storage
        .from(PRIVATE_BUCKET)
        .remove(keys.slice(i, i + 100));
      if (error) throw new Error("private storage delete failed");
    }
    return;
  }
  await Promise.all(keys.map((key) => deletePrivateObject(key)));
}

export async function deleteBrandVoiceCache(brandId: string): Promise<void> {
  await deletePrivateObjectsWithPrefix(`brand-voice-cache/${brandId}/`);
}
