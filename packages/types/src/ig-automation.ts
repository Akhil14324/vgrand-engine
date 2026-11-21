import { z } from "zod";

/* Instagram comment / DM automation: shared request schemas and DTOs. */

export const IG_TRIGGERS = ["comment", "dm"] as const;
export const IG_MATCH_MODES = ["keywords", "exact", "any"] as const;
export const IG_MEDIA_SCOPES = ["all", "selected"] as const;

const trimmedList = (max: number, itemMax: number) =>
  z
    .array(z.string().max(itemMax))
    .max(max)
    .transform((xs) => xs.map((x) => x.trim()).filter(Boolean));

export const igRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
  trigger: z.enum(IG_TRIGGERS).default("comment"),
  matchMode: z.enum(IG_MATCH_MODES).default("keywords"),
  keywords: trimmedList(30, 60).default([]),
  mediaScope: z.enum(IG_MEDIA_SCOPES).default("all"),
  mediaIds: trimmedList(100, 64).default([]),
  publicReplies: trimmedList(10, 2200).default([]),
  dmText: z.string().max(1000).nullable().default(null),
  dmButtonTitle: z.string().trim().max(20).nullable().default(null),
  dmButtonUrl: z.string().trim().max(2000).nullable().default(null),
  oncePerUser: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
});
export type IgRuleInput = z.infer<typeof igRuleInputSchema>;
export const igRuleUpdateSchema = igRuleInputSchema.partial();

export const igTestSchema = z.object({
  trigger: z.enum(IG_TRIGGERS).default("comment"),
  text: z.string().min(1).max(2200),
  mediaId: z.string().max(64).nullable().default(null),
  username: z.string().max(60).nullable().default(null),
});

export interface IgRuleStatsDto {
  triggered: number;
  done: number;
  partial: number;
  failed: number;
  skipped: number;
  publicReplies: number;
  dms: number;
}

export interface IgRuleDto extends IgRuleInput {
  id: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  stats: IgRuleStatsDto;
  problems: string[];
}

export interface IgAccountDto {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  workspaceId: string | null;
  rules: number;
  activeRules: number;
  lastEventAt: string | null;
}

export interface IgAccountStatusDto {
  accountId: string;
  webhook: { callbackUrl: string; verifyTokenSet: boolean; appSecretSet: boolean };
  permissions: { checked: boolean; valid: boolean | null; granted: string[]; missing: string[]; error: string | null };
  subscription: { checked: boolean; subscribed: boolean | null; fields: string[]; error: string | null };
  lastEventAt: string | null;
  ready: boolean;
}

export interface IgEventDto {
  id: string;
  kind: "comment" | "message";
  ruleId: string | null;
  ruleName: string | null;
  mediaId: string | null;
  fromUsername: string | null;
  fromId: string | null;
  text: string | null;
  occurredAt: string;
  status: string;
  skipReason: string | null;
  publicReplyStatus: string | null;
  publicReplyText: string | null;
  dmStatus: string | null;
  dmText: string | null;
  error: string | null;
  processedAt: string | null;
}

export interface IgMediaDto {
  id: string;
  caption: string | null;
  mediaType: string | null;
  productType: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export interface IgTestResultDto {
  matched: boolean;
  ruleId: string | null;
  ruleName: string | null;
  publicReply: string | null;
  publicReplyNote: string | null;
  dm: { text: string; buttonTitle: string | null; buttonUrl: string | null } | null;
}
