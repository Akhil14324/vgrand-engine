import { CRM_FIELDS } from "@catgpt/types";
import { advanceStage } from "../whatsapp/logic.js";

/** CRM pure rules used by the API. No I/O. */

export const CLOSED_STAGES = ["won", "lost"];

export const stageLabel = (s: string) => s.replace("_", " ");

/** Stored field values: non-empty strings only (the JSON column may hold anything). */
export function cleanFields(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if ((typeof v === "string" || typeof v === "number") && String(v).trim()) out[k] = String(v).trim();
  }
  return out;
}

/** Applies an edit: only the keys sent change, and an empty value removes the field. */
export function editFields(current: unknown, edit: Partial<Record<string, string>>): { fields: Record<string, string>; cleared: string[] } {
  const fields = cleanFields(current);
  const cleared: string[] = [];
  for (const key of CRM_FIELDS) {
    const value = edit[key];
    if (value === undefined) continue;
    if (value.trim()) fields[key] = value.trim();
    else {
      delete fields[key];
      cleared.push(key);
    }
  }
  return { fields, cleared };
}

export interface Mergeable {
  name: string | null;
  phone: string | null;
  igUserId: string | null;
  igUsername: string | null;
  stage: string;
  ownerId: string | null;
  followUpOn: Date | null;
  fields: unknown;
  lastActivityAt: Date;
  createdAt: Date;
}

/**
 * Two records of one person (typically Instagram + WhatsApp) combined into `keep`.
 * Returns a reason instead when they carry two different phones or Instagram
 * accounts: merging would drop one, and the next message would recreate it.
 */
export function mergeLeads(keep: Mergeable, other: Mergeable): { problem: string } | { data: Mergeable } {
  if (keep.phone && other.phone && keep.phone !== other.phone) return { problem: "These leads have two different phone numbers" };
  if (keep.igUserId && other.igUserId && keep.igUserId !== other.igUserId) return { problem: "These leads are two different Instagram accounts" };
  const followUps = [keep.followUpOn, other.followUpOn].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  return {
    data: {
      name: keep.name || other.name,
      phone: keep.phone || other.phone,
      igUserId: keep.igUserId || other.igUserId,
      igUsername: keep.igUsername || other.igUsername,
      stage: advanceStage(keep.stage, other.stage),
      ownerId: keep.ownerId || other.ownerId,
      followUpOn: followUps[0] ?? null,
      fields: { ...cleanFields(other.fields), ...cleanFields(keep.fields) },
      lastActivityAt: keep.lastActivityAt > other.lastActivityAt ? keep.lastActivityAt : other.lastActivityAt,
      createdAt: keep.createdAt < other.createdAt ? keep.createdAt : other.createdAt,
    },
  };
}
