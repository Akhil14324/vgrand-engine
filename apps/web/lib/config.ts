const rawApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// A host pasted without a scheme (e.g. "foo.up.railway.app") would be treated
// as a relative path by the browser, so default to https and drop trailing "/".
export const API_URL = (
  /^https?:\/\//i.test(rawApiUrl) ? rawApiUrl : `https://${rawApiUrl}`
).replace(/\/+$/, "");

/** localStorage key holding a workspace invite token across the login redirect. */
export const PENDING_JOIN_KEY = "catgpt-pending-join";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** Login is mandatory — without these the app shows a setup error, never a fake user. */
export const AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Optional demo account shown on the login page for testing. Both must be set
 * (and the account must exist in Supabase Auth) or nothing is shown. Sign-in
 * still goes through Supabase — this only pre-fills/advertises the pair.
 * Never set these to a real user's credentials.
 */
export const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL?.trim() || "";
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "";
export const DEMO_LOGIN_ENABLED = Boolean(DEMO_EMAIL && DEMO_PASSWORD);

/**
 * Upload cap mirrored from the API's MAX_UPLOAD_MB for client-side pre-checks.
 * The server remains authoritative — this just gives instant feedback.
 */
export const MAX_UPLOAD_MB =
  Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 25;
