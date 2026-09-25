import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

  const ext = EXT_BY_MIME[mimeType ?? ""] ?? "png";
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
