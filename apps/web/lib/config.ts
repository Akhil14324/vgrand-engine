export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** True until Supabase env vars are provided — the app runs with a dev user. */
export const DEV_MODE = !(SUPABASE_URL && SUPABASE_ANON_KEY);
