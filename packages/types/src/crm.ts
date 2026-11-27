import { z } from "zod";
import { WA_STAGES } from "./whatsapp";

/*
 * CRM (lead management): shared request schemas, DTOs and the pure rules the API,
 * web and tests all use. Stages are the WhatsApp bot's, so a lead and its chat
 * never disagree.
 */

export const CRM_STAGES = WA_STAGES;
export type CrmStage = (typeof CRM_STAGES)[number];

/** Sources a person can pick. "whatsapp", "instagram" and "import" are also set automatically. */
export const CRM_MANUAL_SOURCES = ["call", "walk_in", "referral", "website", "ads", "other"] as const;
export const CRM_SOURCES = ["whatsapp", "instagram", ...CRM_MANUAL_SOURCES, "import"] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];

/** Requirement fields shown on every lead; the keys match what the WhatsApp bot captures. */
export const CRM_FIELDS = ["budget", "bhk", "location", "timeline", "purpose"] as const;
export type CrmField = (typeof CRM_FIELDS)[number];

export const CRM_DUE = ["overdue", "today", "upcoming", "none"] as const;
export type CrmDue = (typeof CRM_DUE)[number];

export const CRM_MAX_IMPORT = 5000;

const day = z.string().date("Use a real date as YYYY-MM-DD");
const name = z.string().trim().max(120);
const phone = z.string().trim().max(30);
const fields = z.record(z.enum(CRM_FIELDS), z.string().trim().max(200));

export const crmLeadCreateSchema = z
  .object({
    brandId: z.string().min(1),
    name: name.default(""),
    phone: phone.default(""),
    source: z.enum(CRM_MANUAL_SOURCES),
    stage: z.enum(CRM_STAGES).default("new"),
    ownerId: z.string().min(1).nullable().default(null),
    followUpOn: day.nullable().default(null),
    fields: fields.default({}),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((v) => v.name || v.phone, { message: "Enter a name or a phone number" });
export type CrmLeadCreateInput = z.input<typeof crmLeadCreateSchema>;

export const crmLeadUpdateSchema = z.object({
  name: name.optional(),
  phone: phone.optional(),
  stage: z.enum(CRM_STAGES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  followUpOn: day.nullable().optional(),
  /** Only the keys sent are changed; an empty string clears that field. */
  fields: fields.optional(),
});
export type CrmLeadUpdateInput = z.infer<typeof crmLeadUpdateSchema>;

export const crmNoteSchema = z.object({ kind: z.enum(["note", "call"]).default("note"), text: z.string().trim().min(1).max(2000) });
export type CrmNoteInput = z.input<typeof crmNoteSchema>;

export const crmMergeSchema = z.object({ otherId: z.string().min(1) });

export const crmImportSchema = z.object({
  brandId: z.string().min(1),
  rows: z
    .array(
      z.object({
        name: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(30),
        budget: z.string().trim().max(200).optional(),
        bhk: z.string().trim().max(200).optional(),
        location: z.string().trim().max(200).optional(),
        timeline: z.string().trim().max(200).optional(),
        purpose: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(CRM_MAX_IMPORT),
});
export type CrmImportInput = z.infer<typeof crmImportSchema>;

export const crmInstagramRouteSchema = z.object({ accountId: z.string().min(1), brandId: z.string().min(1).nullable() });
export type CrmInstagramRouteInput = z.infer<typeof crmInstagramRouteSchema>;

export interface CrmLeadDto {
  id: string;
  brandId: string;
  name: string | null;
  phone: string | null;
  instagram: string | null;
  fromInstagram: boolean;
  source: CrmSource;
  stage: CrmStage;
  ownerId: string | null;
  ownerName: string | null;
  /** YYYY-MM-DD */
  followUpOn: string | null;
  fields: Partial<Record<string, string>>;
  createdAt: string;
  lastActivityAt: string;
}

export interface CrmActivityDto {
  id: string;
  kind: string;
  text: string;
  /** null = recorded automatically */
  by: string | null;
  createdAt: string;
}

export interface CrmLeadDetailDto {
  lead: CrmLeadDto;
  activities: CrmActivityDto[];
  messages: { id: string; direction: "in" | "out"; text: string | null; createdAt: string }[];
}

export interface CrmMemberDto {
  id: string;
  name: string;
}

export interface CrmLeadListDto {
  items: CrmLeadDto[];
  /** Leads matching the filters (items holds one page of them). */
  total: number;
  counts: { all: number; overdue: number; today: number; byStage: Partial<Record<CrmStage, number>> };
  members: CrmMemberDto[];
  /** True for the brand owner: import, export, delete and Instagram setup. */
  canManage: boolean;
}

export interface CrmInstagramAccountDto {
  accountId: string;
  handle: string | null;
  brandId: string | null;
  brandName: string | null;
}

/* ------------------------------- pure rules -------------------------------- */

export function followUpDue(followUpOn: string | null, today: string): CrmDue {
  if (!followUpOn) return "none";
  return followUpOn < today ? "overdue" : followUpOn === today ? "today" : "upcoming";
}

/** Minimal RFC 4180 reader: quoted cells, doubled quotes, commas or tabs, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const HEADERS: Record<string, keyof CrmImportInput["rows"][number]> = {
  name: "name", "customer name": "name", "full name": "name",
  phone: "phone", mobile: "phone", number: "phone", "phone number": "phone", "mobile number": "phone", contact: "phone",
  budget: "budget", bhk: "bhk", location: "location", area: "location", timeline: "timeline", purpose: "purpose",
};

/**
 * Turns pasted or uploaded CSV into import rows. With a header row the columns are
 * matched by title; without one they are read as "phone, name".
 */
export function csvToImportRows(text: string): CrmImportInput["rows"] {
  const table = parseCsv(text);
  const first = table[0];
  if (!first) return [];
  const keys = first.map((h) => HEADERS[h.trim().toLowerCase()]);
  const hasHeader = keys.includes("phone");
  const columns = hasHeader ? keys : (["phone", "name"] as const);
  return (hasHeader ? table.slice(1) : table).flatMap((cells) => {
    const row: Record<string, string> = {};
    columns.forEach((key, i) => {
      const value = cells[i]?.trim();
      if (key && value) row[key] = value.slice(0, key === "phone" ? 30 : key === "name" ? 120 : 200);
    });
    return row.phone ? [row as CrmImportInput["rows"][number]] : [];
  });
}

/** Cells starting with = + - @ would run as formulas in Excel, so they are quoted as text. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
