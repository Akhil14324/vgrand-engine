import { z } from "zod";

/* ------------------------ workspace privacy & consent ------------------------ */

/** Shortest retention window an owner can choose (protects against accidental mass deletion). */
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

export interface WorkspacePrivacyDto {
  /** Generated images older than this are deleted automatically. null = keep forever. */
  retentionDays: number | null;
}

export const updateWorkspacePrivacySchema = z.object({
  retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).nullable(),
});
export type UpdateWorkspacePrivacyRequest = z.infer<typeof updateWorkspacePrivacySchema>;

/** Deleting generated content requires typing the workspace name. */
export const deleteWorkspaceDataSchema = z.object({ confirm: z.string().min(1).max(200) });
export type DeleteWorkspaceDataRequest = z.infer<typeof deleteWorkspaceDataSchema>;
export interface DeleteWorkspaceDataDto {
  conversationsDeleted: number;
  imagesDeleted: number;
}

export const CONSENT_KINDS = ["ugc_repost", "testimonial", "dm_contact", "other"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** One person's consent (e.g. to repost their photo), kept as an audit trail. Revoke, never edit. */
export interface ConsentRecordDto {
  id: string;
  workspaceId: string;
  brandId: string | null;
  /** Who consented: a handle, name or email. */
  subject: string;
  kind: ConsentKind;
  /** What exactly was agreed to. */
  scope: string | null;
  /** Link to the message or screenshot that proves it. */
  evidenceUrl: string | null;
  grantedAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export const createConsentSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  kind: z.enum(CONSENT_KINDS),
  scope: z.string().trim().max(1000).optional(),
  evidenceUrl: z.string().trim().url().max(1000).optional(),
  brandId: z.string().uuid().optional(),
  /** ISO time consent was given; defaults to now. Cannot be in the future. */
  grantedAt: z.string().datetime().optional(),
});
export type CreateConsentRequest = z.infer<typeof createConsentSchema>;
