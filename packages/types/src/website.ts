import { z } from "zod";

/*
 * "Website to CatGPT integration": a read-only view of the company website's own
 * Supabase data (vgrandgroup.com): form leads, button clicks, visitor sources and the
 * phone numbers people chose to share in the welcome pop-up. Separate from the CRM.
 */

export const WEBSITE_DAYS = [7, 30, 90] as const;
export const WEBSITE_PAGE_SIZE = 50;

export const websiteOverviewQuery = z.object({
  days: z.coerce.number().int().refine((d) => (WEBSITE_DAYS as readonly number[]).includes(d), "days must be 7, 30 or 90").default(30),
});

export const websiteListQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  q: z.string().trim().max(80).optional(),
});

export interface WebsiteCountDto {
  name: string;
  total: number;
}

export interface WebsiteOverviewDto {
  days: number;
  /** form leads in the period */
  leads: number;
  /** pop-up phone numbers in the period (0 when the website hasn't added that column yet) */
  consentNumbers: number;
  /** false when the website's click table doesn't exist yet */
  clicksReady: boolean;
  /** button taps by type: call_click, whatsapp_click … */
  clicks: WebsiteCountDto[];
  /** where the visitors who tapped came from */
  visitorSources: WebsiteCountDto[];
  /** where the leads came from */
  leadSources: WebsiteCountDto[];
}

export interface WebsiteLeadDto {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** website form id: contact_page, site_visit, enquire_now, brochure_download, consent_popup … */
  form: string | null;
  project: string | null;
  message: string | null;
  status: string | null;
  /** first-visit source: instagram, google, google_ads … (null = not recorded) */
  source: string | null;
  campaign: string | null;
  landingPage: string | null;
  createdAt: string;
}

export interface WebsiteConsentDto {
  id: string;
  phone: string;
  consentText: string | null;
  source: string | null;
  page: string | null;
  createdAt: string;
}

export interface WebsiteListDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** set when the website hasn't added the data this list needs yet */
  notice?: string;
}
