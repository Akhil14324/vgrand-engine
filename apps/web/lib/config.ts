const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// A host pasted without a scheme (e.g. "foo.up.railway.app") would be treated
// as a relative path by the browser, so default to https and drop trailing "/".
export const API_URL = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(
  /\/+$/,
  "",
);
