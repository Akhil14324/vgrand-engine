import { prisma } from "@catgpt/db";
import type {
  ConsentKind,
  ConsentRecordDto,
  CreateConsentRequest,
  DeleteWorkspaceDataDto,
  WorkspacePrivacyDto,
} from "@catgpt/types";
import { badRequest, notFound } from "../lib/errors.js";
import { findWorkspaceForUser } from "../lib/workspace-access.js";
import { deleteStoredFiles } from "./storage.js";

const DAY_MS = 86_400_000;
const PURGE_BATCH = 200;
const MAX_BATCHES_PER_RUN = 10;
const EXPORT_LIMIT = 5000;

/* -------------------------------- retention -------------------------------- */

export async function getPrivacy(userId: string, workspaceId: string): Promise<WorkspacePrivacyDto> {
  await findWorkspaceForUser(userId, workspaceId);
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { retentionDays: true } });
  return { retentionDays: ws?.retentionDays ?? null };
}

export async function setRetention(userId: string, workspaceId: string, days: number | null): Promise<WorkspacePrivacyDto> {
  await findWorkspaceForUser(userId, workspaceId, { ownerOnly: true });
  await prisma.workspace.update({ where: { id: workspaceId }, data: { retentionDays: days } });
  return { retentionDays: days };
}

/**
 * Removes stored files, except any still referenced elsewhere (a brand asset,
 * e.g. a mascot picked from a generation, or a social post's media snapshot).
 */
export async function deleteFilesUnlessInUse(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return;
  const [assets, posts] = await Promise.all([
    prisma.brandAsset.findMany({ where: { url: { in: unique } }, select: { url: true } }),
    prisma.socialPost.findMany({ where: { mediaUrl: { in: unique } }, select: { mediaUrl: true } }),
  ]);
  const used = new Set([...assets.map((a) => a.url), ...posts.map((p) => p.mediaUrl)]);
  await deleteStoredFiles(unique.filter((u) => !used.has(u)));
}

/**
 * Deletes finished generated IMAGES older than the window. Images used by a
 * social post or a campaign post are kept (they are part of the calendar and
 * post history), and chat text is never touched.
 */
export async function purgeExpiredMedia(workspaceId: string, retentionDays: number, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - retentionDays * DAY_MS);
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await prisma.generation.findMany({
      where: {
        kind: "image",
        createdAt: { lt: cutoff },
        status: { in: ["completed", "failed", "cancelled"] },
        conversation: { workspaceId },
        socialPosts: { none: {} },
        campaignPost: { is: null },
      },
      select: { id: true, imageUrls: true },
      take: PURGE_BATCH,
    });
    if (batch.length === 0) break;
    await prisma.generation.deleteMany({ where: { id: { in: batch.map((g) => g.id) } } });
    await deleteFilesUnlessInUse(batch.flatMap((g) => g.imageUrls));
    deleted += batch.length;
    if (batch.length < PURGE_BATCH) break;
  }
  return deleted;
}

async function runRetentionSweep(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { retentionDays: { not: null } },
    select: { id: true, retentionDays: true },
  });
  for (const ws of workspaces) {
    try {
      const n = await purgeExpiredMedia(ws.id, ws.retentionDays!);
      if (n > 0) console.log(`[retention] workspace ${ws.id}: deleted ${n} expired image(s)`);
    } catch (err) {
      console.error(`[retention] workspace ${ws.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

let retentionStarted = false;
/**
 * Runs a sweep shortly after boot and then every 6 hours. Safe with several
 * instances: deletion is idempotent, so overlapping sweeps only repeat no-ops.
 */
export function startRetentionScheduler(): void {
  if (retentionStarted) return;
  retentionStarted = true;
  const tick = () => void runRetentionSweep().catch((err) => console.error("[retention]", err));
  setTimeout(tick, 2 * 60_000).unref();
  setInterval(tick, 6 * 3_600_000).unref();
}

/* --------------------------------- export ---------------------------------- */

/**
 * Everything the workspace owner is responsible for, as one JSON document.
 * Media is included as links (files stay in storage), and no credentials or
 * social tokens are ever exported.
 */
export async function exportWorkspaceData(userId: string, workspaceId: string) {
  await findWorkspaceForUser(userId, workspaceId, { ownerOnly: true });
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { id: true, name: true, retentionDays: true, createdAt: true },
  });
  const [members, brands, conversations, generations, socialPosts, compliance, consents, socialAccounts] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, createdAt: true } }),
    prisma.brand.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        category: true,
        profile: true,
        createdAt: true,
        assets: { select: { kind: true, url: true, label: true } },
        guidelines: { select: { content: true, version: true, updatedAt: true } },
      },
    }),
    prisma.conversation.findMany({
      where: { workspaceId },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      take: EXPORT_LIMIT,
    }),
    prisma.generation.findMany({
      where: { conversation: { workspaceId } },
      select: { id: true, kind: true, prompt: true, textResponse: true, imageUrls: true, status: true, brandId: true, conversationId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
    }),
    prisma.socialPost.findMany({
      where: { workspaceId },
      select: { id: true, generationId: true, status: true, content: true, mediaUrl: true, scheduledFor: true, postedAt: true, remoteUrl: true, account: { select: { platform: true, handle: true } } },
      take: EXPORT_LIMIT,
    }),
    prisma.complianceCheck.findMany({
      where: { brand: { workspaceId } },
      select: { id: true, brandId: true, generationId: true, status: true, ruleFindings: true, aiFindings: true, overridden: true, createdAt: true },
      take: EXPORT_LIMIT,
    }),
    prisma.consentRecord.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } }),
    prisma.socialAccount.findMany({ where: { workspaceId }, select: { platform: true, handle: true, displayName: true, status: true, createdAt: true } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    note: "Media files are referenced by URL. Social account tokens are never included.",
    workspace: ws,
    members,
    brands,
    conversations,
    generations,
    socialPosts,
    socialAccounts,
    complianceChecks: compliance,
    consentRecords: consents,
    truncated: { limit: EXPORT_LIMIT, generations: generations.length === EXPORT_LIMIT, conversations: conversations.length === EXPORT_LIMIT },
  };
}

/* ------------------------------ delete content ------------------------------ */

/**
 * Deletes every chat and generated image in the workspace (owner only, and the
 * workspace name must be typed). Brands, brand assets, guidelines, documents,
 * team chat and the consent log are kept. Posts already published stay on the
 * platforms; scheduled ones made from these images are removed with them.
 */
export async function deleteWorkspaceContent(userId: string, workspaceId: string, confirm: string): Promise<DeleteWorkspaceDataDto> {
  const ws = await findWorkspaceForUser(userId, workspaceId, { ownerOnly: true });
  if (confirm.trim() !== ws.name.trim()) throw badRequest("Type the workspace name exactly to confirm");

  const [generations, docs, conversationCount] = await Promise.all([
    prisma.generation.findMany({ where: { conversation: { workspaceId } }, select: { imageUrls: true, kind: true } }),
    prisma.document.findMany({ where: { conversation: { workspaceId } }, select: { storageUrl: true } }),
    prisma.conversation.count({ where: { workspaceId } }),
  ]);
  await prisma.conversation.deleteMany({ where: { workspaceId } });
  await deleteFilesUnlessInUse([
    ...generations.flatMap((g) => g.imageUrls),
    ...docs.map((d) => d.storageUrl).filter((u): u is string => !!u),
  ]);
  return { conversationsDeleted: conversationCount, imagesDeleted: generations.reduce((n, g) => n + g.imageUrls.length, 0) };
}

/* ------------------------------- consent log ------------------------------- */

const toConsentDto = (r: {
  id: string;
  workspaceId: string;
  brandId: string | null;
  subject: string;
  kind: string;
  scope: string | null;
  evidenceUrl: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}): ConsentRecordDto => ({
  id: r.id,
  workspaceId: r.workspaceId,
  brandId: r.brandId,
  subject: r.subject,
  kind: r.kind as ConsentKind,
  scope: r.scope,
  evidenceUrl: r.evidenceUrl,
  grantedAt: r.grantedAt.toISOString(),
  revokedAt: r.revokedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

/** Any workspace member can read and add to the consent log. */
export async function listConsents(userId: string, workspaceId: string): Promise<ConsentRecordDto[]> {
  await findWorkspaceForUser(userId, workspaceId);
  const rows = await prisma.consentRecord.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(toConsentDto);
}

export async function addConsent(userId: string, workspaceId: string, body: CreateConsentRequest): Promise<ConsentRecordDto> {
  await findWorkspaceForUser(userId, workspaceId);
  const grantedAt = body.grantedAt ? new Date(body.grantedAt) : new Date();
  if (grantedAt.getTime() > Date.now() + 60_000) throw badRequest("Consent cannot be dated in the future");
  if (body.brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: body.brandId, workspaceId }, select: { id: true } });
    if (!brand) throw badRequest("That brand isn't in this workspace");
  }
  const row = await prisma.consentRecord.create({
    data: {
      workspaceId,
      brandId: body.brandId ?? null,
      createdBy: userId,
      subject: body.subject,
      kind: body.kind,
      scope: body.scope || null,
      evidenceUrl: body.evidenceUrl || null,
      grantedAt,
    },
  });
  return toConsentDto(row);
}

/** Withdrawn consent is stamped, not removed, so the history stays intact. */
export async function revokeConsent(userId: string, workspaceId: string, consentId: string): Promise<ConsentRecordDto> {
  await findWorkspaceForUser(userId, workspaceId);
  const res = await prisma.consentRecord.updateMany({
    where: { id: consentId, workspaceId, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: userId },
  });
  if (res.count === 0) {
    const exists = await prisma.consentRecord.findFirst({ where: { id: consentId, workspaceId } });
    if (!exists) throw notFound("Consent record not found");
  }
  const row = await prisma.consentRecord.findUniqueOrThrow({ where: { id: consentId } });
  return toConsentDto(row);
}
