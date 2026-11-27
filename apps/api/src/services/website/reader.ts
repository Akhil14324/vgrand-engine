import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@catgpt/db";
import {
  WEBSITE_PAGE_SIZE,
  toCsv,
  type WebsiteConsentDto,
  type WebsiteLeadDto,
  type WebsiteListDto,
  type WebsiteOverviewDto,
} from "@catgpt/types";
import { env } from "../../env.js";
import { HttpError, forbidden } from "../../lib/errors.js";
import { canView, countBy, isMissing, leadsCsvRows, searchTerm, toConsentDto, toLeadDto } from "./logic.js";

/*
 * Website to CatGPT integration: reads the company website's OWN Supabase project
 * (tables leads, site_events, consent_logs). Only SELECTs are ever sent. It works with
 * whatever the website has today: a table or column the website hasn't added yet just
 * shows as empty, with a notice, instead of failing the page.
 */

let client: SupabaseClient | null = null;
function website(): SupabaseClient {
  if (!env.WEBSITE_SUPABASE_URL || !env.WEBSITE_SUPABASE_SERVICE_KEY) {
    throw new HttpError(503, "The website isn't connected yet. Set WEBSITE_SUPABASE_URL and WEBSITE_SUPABASE_SERVICE_KEY on the CatGPT server.", "WEBSITE_NOT_CONFIGURED");
  }
  client ??= createClient(env.WEBSITE_SUPABASE_URL, env.WEBSITE_SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** The page shows customers' phone numbers, so only listed emails may open it. */
export async function assertWebsiteViewer(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!canView(user?.email, env.WEBSITE_VIEWER_EMAILS)) {
    throw forbidden("Ask an admin to add your login email to WEBSITE_VIEWER_EMAILS to see the website's leads.");
  }
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const fail = (what: string, e: { message?: string }) => new HttpError(502, `Could not read ${what} from the website: ${e.message ?? "unknown error"}`, "WEBSITE_READ_FAILED");

export async function websiteOverview(days: number): Promise<WebsiteOverviewDto> {
  const db = website();
  const from = since(days);

  const [leadCount, leadSrc, consent, events] = await Promise.all([
    db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", from),
    db.from("leads").select("utm_source").gte("created_at", from).limit(20_000),
    db.from("consent_logs").select("id", { count: "exact", head: true }).gte("created_at", from).not("phone", "is", null),
    db.from("site_events").select("event_type, utm_source").gte("created_at", from).limit(20_000),
  ]);

  if (leadCount.error) throw fail("leads", leadCount.error);
  if (consent.error && !isMissing(consent.error)) throw fail("pop-up numbers", consent.error);
  if (events.error && !isMissing(events.error)) throw fail("button clicks", events.error);
  if (leadSrc.error && !isMissing(leadSrc.error)) throw fail("lead sources", leadSrc.error);

  const rows = (events.data ?? []) as Record<string, unknown>[];
  return {
    days,
    leads: leadCount.count ?? 0,
    consentNumbers: consent.error ? 0 : consent.count ?? 0,
    clicksReady: !events.error,
    clicks: countBy(rows, "event_type", "other"),
    visitorSources: countBy(rows, "utm_source"),
    leadSources: leadSrc.error ? [] : countBy((leadSrc.data ?? []) as Record<string, unknown>[], "utm_source"),
  };
}

async function leadsPage(page: number, q: string | undefined, size: number): Promise<WebsiteListDto<WebsiteLeadDto>> {
  let query = website().from("leads").select("*", { count: "exact" }).order("created_at", { ascending: false });
  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.*${term}*,phone.ilike.*${term}*,email.ilike.*${term}*`);
  const { data, error, count } = await query.range((page - 1) * size, page * size - 1);
  if (error) throw fail("leads", error);
  return { items: (data ?? []).map((r) => toLeadDto(r as Record<string, unknown>)), total: count ?? 0, page, pageSize: size };
}

export const websiteLeads = (page: number, q?: string) => leadsPage(page, q, WEBSITE_PAGE_SIZE);

export async function websiteConsents(page: number): Promise<WebsiteListDto<WebsiteConsentDto>> {
  const { data, error, count } = await website()
    .from("consent_logs")
    .select("*", { count: "exact" })
    .not("phone", "is", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * WEBSITE_PAGE_SIZE, page * WEBSITE_PAGE_SIZE - 1);
  if (error) {
    if (isMissing(error)) {
      return {
        items: [],
        total: 0,
        page,
        pageSize: WEBSITE_PAGE_SIZE,
        notice: "The website isn't saving pop-up phone numbers yet. It starts once the website's lead-tracking update is live and supabase_lead_tracking.sql has been run.",
      };
    }
    throw fail("pop-up numbers", error);
  }
  const items = (data ?? []).map((r) => toConsentDto(r as Record<string, unknown>)).filter((c): c is WebsiteConsentDto => !!c);
  return { items, total: count ?? 0, page, pageSize: WEBSITE_PAGE_SIZE };
}

/** Up to 5,000 newest leads as CSV (with a BOM so Excel reads Telugu names). */
export async function websiteLeadsCsv(q?: string): Promise<string> {
  const { items } = await leadsPage(1, q, 5000);
  return String.fromCharCode(0xfeff) + toCsv(leadsCsvRows(items));
}
