const rawApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// A host pasted without a scheme (e.g. "foo.up.railway.app") would be treated
// as a relative path by the browser, so default to https and drop trailing "/".
export const API_URL = (
  /^https?:\/\//i.test(rawApiUrl) ? rawApiUrl : `https://${rawApiUrl}`
).replace(/\/+$/, "");

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** True until Supabase env vars are provided — the app runs with a dev user. */
export const DEV_MODE = !(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Upload cap mirrored from the API's MAX_UPLOAD_MB for client-side pre-checks.
 * The server remains authoritative — this just gives instant feedback.
 */
export const MAX_UPLOAD_MB =
  Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 25;
