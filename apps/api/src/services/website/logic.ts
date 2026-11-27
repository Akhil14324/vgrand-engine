import type { WebsiteConsentDto, WebsiteCountDto, WebsiteLeadDto } from "@catgpt/types";

/** Website integration: pure rules (no I/O), shared by the reader and its tests. */

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Who may see the website data: the comma-separated allowlist, compared case-insensitively. */
export function canView(email: string | null | undefined, allowlist: string | undefined): boolean {
  if (!email || !allowlist) return false;
  const allowed = allowlist.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/** Counts rows by one column, biggest first; empty values count as `empty`. */
export function countBy(rows: Row[], key: string, empty = "direct"): WebsiteCountDto[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = str(r[key]) ?? empty;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, total]) => ({ name, total }));
}

/**
 * Text for a PostgREST `or=(…ilike…)` search. Characters that would change the filter
 * itself (commas, brackets, dots, wildcards, quotes, backslashes) are removed.
 */
export function searchTerm(q: string | undefined): string | null {
  const t = (q ?? "").replace(/[,()*%.:"'\\]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 ? t.slice(0, 60) : null;
}

/** Postgres / PostgREST "no such table or column": the website hasn't added it yet. */
export const isMissing = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST205" || /does not exist|Could not find the/i.test(e.message ?? ""));

/** One `leads` row of the website, whatever columns it has, in the page's shape. */
export function toLeadDto(r: Row): WebsiteLeadDto {
  return {
    id: str(r.id) ?? "",
    name: str(r.name),
    phone: str(r.phone),
    email: str(r.email),
    form: str(r.source),
    project: str(r.project) ?? str(r.interested_flat),
    message: str(r.message),
    status: str(r.status),
    source: str(r.utm_source),
    campaign: str(r.utm_campaign),
    landingPage: str(r.landing_page),
    createdAt: str(r.created_at) ?? new Date(0).toISOString(),
  };
}

export function toConsentDto(r: Row): WebsiteConsentDto | null {
  const phone = str(r.phone);
  if (!phone) return null;
  return {
    id: str(r.id) ?? "",
    phone,
    consentText: str(r.consent_text),
    source: str(r.utm_source),
    page: str(r.page_url),
    createdAt: str(r.created_at) ?? new Date(0).toISOString(),
  };
}

const FORM_LABEL: Record<string, string> = {
  contact_page: "Contact form",
  site_visit: "Site visit form",
  enquire_now: "Enquire Now",
  brochure_download: "Brochure download",
  consent_popup: "Welcome pop-up",
};
export const formLabel = (form: string | null) => (form ? FORM_LABEL[form] ?? form.replace(/_/g, " ") : "");

/** CSV rows for the leads export. */
export function leadsCsvRows(items: WebsiteLeadDto[]): string[][] {
  return [
    ["Date", "Name", "Phone", "Email", "Form", "Project", "Message", "Source", "Campaign", "Landing page", "Status"],
    ...items.map((l) => [
      l.createdAt.slice(0, 16).replace("T", " "),
      l.name ?? "",
      l.phone ?? "",
      l.email ?? "",
      formLabel(l.form),
      l.project ?? "",
      l.message ?? "",
      l.source ?? "",
      l.campaign ?? "",
      l.landingPage ?? "",
      l.status ?? "",
    ]),
  ];
}
