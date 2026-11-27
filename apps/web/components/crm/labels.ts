import type { CrmField, CrmSource, CrmStage } from "@catgpt/types";
import { ApiRequestError } from "@/lib/api";

export const STAGE_LABEL: Record<CrmStage, string> = { new: "New", engaged: "Engaged", qualified: "Qualified", site_visit: "Site visit", won: "Won", lost: "Lost" };
export const SOURCE_LABEL: Record<CrmSource, string> = {
  whatsapp: "WhatsApp", instagram: "Instagram", call: "Phone call", walk_in: "Walk-in", referral: "Referral", website: "Website", ads: "Ads", other: "Other", import: "Imported",
};
export const FIELD_LABEL: Record<CrmField, string> = { budget: "Budget", bhk: "BHK", location: "Preferred location", timeline: "Timeline", purpose: "Purpose" };

export const errText = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : fallback);
export const leadName = (l: { name: string | null; instagram: string | null; phone: string | null }) =>
  l.name || (l.instagram ? `@${l.instagram}` : l.phone ? `+${l.phone}` : "Instagram user");
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** "2026-11-28" → "28 Nov", without time-zone shifts. */
export const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
