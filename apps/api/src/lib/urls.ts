import { env } from "../env.js";

/**
 * Image URLs the server will fetch on a user's behalf (reference images) must
 * point at storage we control — otherwise a client could make the API request
 * internal addresses (SSRF). Accepts our Supabase Storage objects and files
 * served from this API's own /uploads/.
 */
export function isTrustedImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;

  if (env.SUPABASE_URL) {
    const supabase = new URL(env.SUPABASE_URL);
    if (
      url.host === supabase.host &&
      url.pathname.startsWith("/storage/v1/object/")
    ) {
      return true;
    }
  }
  const api = new URL(env.API_PUBLIC_URL);
  return url.host === api.host && url.pathname.startsWith("/uploads/");
}
