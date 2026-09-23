import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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

function getSupabase(): SupabaseClient | null {
  if (!env.supabaseConfigured) return null;
  supabase ??= createClient(
    env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return supabase;
}

async function ensureBucket(client: SupabaseClient) {
  if (bucketEnsured) return;
  const { error } = await client.storage.createBucket(env.STORAGE_BUCKET, {
    public: true,
  });
  // "already exists" is fine — anything else surfaces on upload anyway.
  if (error && !/already exists/i.test(error.message)) {
    console.warn(`storage bucket create: ${error.message}`);
  }
  bucketEnsured = true;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
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
    const res = await fetch(input.sourceUrl);
    if (!res.ok) {
      throw new Error(`failed to fetch provider image (${res.status})`);
    }
    buffer = Buffer.from(await res.arrayBuffer());
    mimeType ??= res.headers.get("content-type") ?? undefined;
  }
  if (!buffer) throw new Error("storeImage: no buffer or sourceUrl");

  const ext = EXT_BY_MIME[mimeType ?? ""] ?? "png";
  const key = `${input.keyPrefix}/${randomBytes(8).toString("hex")}.${ext}`;

  const client = getSupabase();
  if (client) {
    await ensureBucket(client);
    const { error } = await client.storage
      .from(env.STORAGE_BUCKET)
      .upload(key, buffer, { contentType: mimeType ?? "image/png" });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    const { data } = client.storage
      .from(env.STORAGE_BUCKET)
      .getPublicUrl(key);
    return data.publicUrl;
  }

  const filePath = path.join(env.UPLOAD_DIR, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `${env.API_PUBLIC_URL}/uploads/${key}`;
}
