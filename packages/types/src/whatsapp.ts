import { z } from "zod";

/* WhatsApp (Meta Cloud API): shared request schemas and DTOs. */

export const WA_BOT_MODES = ["off", "menu", "ai", "hybrid"] as const;
export type WaBotMode = (typeof WA_BOT_MODES)[number];
export const WA_STAGES = ["new", "engaged", "qualified", "site_visit", "won", "lost"] as const;
export type WaStage = (typeof WA_STAGES)[number];
export const WA_KINDS = ["lead", "buyer"] as const;
export const WA_MAX_MENU = 10;

/** A tap-to-select item. "capture" starts the lead questions; "human" hands over. */
export const waMenuItemSchema = z.object({
  id: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(24),
  kind: z.enum(["reply", "link", "capture", "human"]).default("reply"),
  text: z.string().trim().max(1000).default(""),
  url: z.string().trim().max(2000).nullable().default(null),
  imageUrl: z.string().trim().max(2000).nullable().default(null),
});
export type WaMenuItem = z.infer<typeof waMenuItemSchema>;

export const waConnectSchema = z.object({
  brandId: z.string().min(1),
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "Phone number ID is digits only"),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "WhatsApp Business Account ID is digits only"),
  accessToken: z.string().trim().min(20).max(1000),
});
export type WaConnectInput = z.infer<typeof waConnectSchema>;

export const waSettingsSchema = z.object({
  botMode: z.enum(WA_BOT_MODES),
  greeting: z.string().trim().max(1000),
  aiInstructions: z.string().trim().max(3000),
  menu: z.array(waMenuItemSchema).max(WA_MAX_MENU),
  handoffKeywords: z.array(z.string().trim().min(1).max(40)).max(20),
  handoffMessage: z.string().trim().max(1000),
});
export type WaSettingsInput = z.infer<typeof waSettingsSchema>;

export const waContactUpdateSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  kind: z.enum(WA_KINDS).optional(),
  stage: z.enum(WA_STAGES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  botPaused: z.boolean().optional(),
  /** Owner confirms this person agreed to marketing messages (or withdraws it). */
  optedIn: z.boolean().optional(),
});

export const waImportSchema = z.object({
  kind: z.enum(WA_KINDS).default("lead"),
  /** Only set true when these people agreed to receive WhatsApp messages. */
  consent: z.literal(true, { errorMap: () => ({ message: "Confirm these people agreed to get WhatsApp messages" }) }),
  consentSource: z.string().trim().min(2).max(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  rows: z.array(z.object({ phone: z.string().trim().min(5).max(30), name: z.string().trim().max(120).optional() })).min(1).max(5000),
});

export const waSendSchema = z.object({ text: z.string().trim().min(1).max(4000) });

const templateName = z.string().trim().regex(/^[a-z][a-z0-9_]{2,59}$/, "Lowercase letters, digits and underscores only");
export const waButtonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), text: z.string().trim().min(1).max(25), url: z.string().url().max(2000) }),
  z.object({ type: z.literal("phone"), text: z.string().trim().min(1).max(25), phone: z.string().trim().regex(/^\+\d{7,15}$/, "Use +countrycode number") }),
  z.object({ type: z.literal("quick_reply"), text: z.string().trim().min(1).max(25) }),
]);
export type WaButton = z.infer<typeof waButtonSchema>;

export const waTemplateInputSchema = z.object({
  name: templateName,
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default("en"),
  category: z.enum(["MARKETING", "UTILITY"]).default("MARKETING"),
  headerUrl: z.string().url().max(2000).nullable().default(null),
  body: z.string().trim().min(1).max(1024),
  /** One name per {{n}} placeholder, in order. */
  variables: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  examples: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  buttons: z.array(waButtonSchema).max(3).default([]),
});
export type WaTemplateInput = z.infer<typeof waTemplateInputSchema>;

export const waBroadcastInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().min(1),
  audience: z
    .object({
      kind: z.enum(WA_KINDS).optional(),
      stages: z.array(z.enum(WA_STAGES)).max(6).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    })
    .default({}),
  /** Per template variable: "name" | "field:<key>" | "text:<literal>" */
  variableMap: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  scheduledAt: z.string().datetime().nullable().default(null),
});
export type WaBroadcastInput = z.infer<typeof waBroadcastInputSchema>;

export interface WaNumberDto {
  id: string;
  brandId: string;
  brandName: string;
  phoneNumberId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  status: string;
  botMode: WaBotMode;
  greeting: string;
  aiInstructions: string;
  menu: WaMenuItem[];
  handoffKeywords: string[];
  handoffMessage: string;
  createdAt: string;
  /** Set on connect / token replace when Meta refused the webhook subscription. */
  warning?: string | null;
}
export interface WaContactDto {
  id: string;
  waId: string;
  name: string | null;
  kind: string;
  stage: string;
  tags: string[];
  fields: Record<string, string>;
  optedIn: boolean;
  optedOutAt: string | null;
  botPaused: boolean;
  unreadCount: number;
  /** True while a free-form reply is still allowed (24 h after their last message). */
  canReply: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
}
export interface WaMessageDto {
  id: string;
  direction: "in" | "out";
  source: string;
  type: string;
  text: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}
export interface WaTemplateDto {
  id: string;
  name: string;
  language: string;
  category: string;
  headerUrl: string | null;
  body: string;
  variables: string[];
  examples: string[];
  buttons: WaButton[];
  metaStatus: string;
  rejectReason: string | null;
}
export interface WaBroadcastDto {
  id: string;
  name: string;
  templateName: string;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  counts: { total: number; sent: number; delivered: number; read: number; failed: number };
}
export interface WaWebhookStatusDto {
  callbackUrl: string;
  verifyTokenSet: boolean;
  appSecretSet: boolean;
  tokenKeySet: boolean;
}
