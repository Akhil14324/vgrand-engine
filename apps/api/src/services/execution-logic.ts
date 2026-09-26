import {
  DELIVERABLE_TYPE_LABELS,
  GENERATABLE_TYPES,
  PUBLISHABLE_CHANNELS,
  normalizeChannel,
  type DeliverableStatus,
  type DeliverableType,
  type PublishingState,
  type StrategyPlan,
} from "@catgpt/types";

export interface PostFact {
  status: string;
  scheduledFor: Date | null;
  remoteUrl: string | null;
  error: string | null;
  createdAt: Date;
}
export interface AccountFact {
  platform: string;
  status: string;
}

/**
 * What can honestly be said about publishing a deliverable. "published" and
 * "scheduled" come only from SocialPost rows written by the publishing service;
 * nothing here can invent a success.
 */
export function derivePublishing(input: {
  status: DeliverableStatus;
  type: DeliverableType;
  channel: string | null;
  generationId: string | null;
  posts: PostFact[];
  accounts: AccountFact[];
}): PublishingState {
  const posts = [...input.posts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const posted = posts.find((p) => p.status === "posted");
  if (posted) return { kind: "published", url: posted.remoteUrl };
  const pending = posts.find((p) => ["scheduled", "pending", "posting"].includes(p.status));
  if (pending) return { kind: "scheduled", at: pending.scheduledFor?.toISOString() ?? null };
  if (posts[0]?.status === "failed") return { kind: "failed", error: posts[0].error };

  if (input.status !== "approved" && input.status !== "completed") return { kind: "blocked_by_approval" };

  const channel = normalizeChannel(input.channel);
  if (!input.generationId) {
    return { kind: "manual", reason: "No generated content is attached, so there is nothing the platform can publish." };
  }
  if (!GENERATABLE_TYPES.includes(input.type)) {
    return { kind: "manual", reason: `${DELIVERABLE_TYPE_LABELS[input.type]} cannot be published from this platform.` };
  }
  if (!(PUBLISHABLE_CHANNELS as readonly string[]).includes(channel)) {
    return { kind: "manual", reason: channel ? `Publishing to ${channel} is not supported here.` : "No channel was chosen." };
  }
  const account = input.accounts.find((a) => a.platform === channel);
  if (!account) return { kind: "not_connected", platform: channel };
  if (account.status !== "active") return { kind: "reauth_required", platform: channel };
  return { kind: "ready", platform: channel };
}

/** Plain-language steps for work the platform cannot execute itself. */
export function manualSteps(input: { type: DeliverableType; channel: string | null; state: PublishingState }): string[] {
  const s = input.state;
  if (s.kind === "published" || s.kind === "scheduled" || s.kind === "blocked_by_approval" || s.kind === "ready") return [];
  const ch = normalizeChannel(input.channel) || "the channel";
  const steps: string[] = [];
  if (s.kind === "not_connected") steps.push(`Connect your ${s.platform} account from the Social Calendar, then publish from here.`);
  if (s.kind === "reauth_required") steps.push(`Reconnect your ${s.platform} account - its permission has expired or was revoked.`);
  if (s.kind === "failed") steps.push("Read the error below, fix the cause, then retry from the post.");
  steps.push(
    input.type === "landing_page" || input.type === "ad_setup" || input.type === "email"
      ? `Do this outside the platform (${ch}), using the approved brief.`
      : `Download the approved content and post it manually on ${ch}.`,
  );
  steps.push("When it is live, choose Mark as done and paste the link so the record shows what really happened.");
  return steps;
}

/** Whether the platform can generate content for this deliverable today. */
export const canGenerateFor = (type: DeliverableType) => GENERATABLE_TYPES.includes(type);

/**
 * The context handed to content generation, so nobody re-types the brief.
 * Everything comes from the saved plan and the deliverable, not from the client.
 */
export function buildContentPrompt(input: {
  plan: StrategyPlan;
  brandName: string;
  deliverable: { type: DeliverableType; title: string; channel: string | null; format: string | null; brief: string };
  feedback?: string | null;
}): string {
  const { plan, deliverable: d } = input;
  const lines = [
    `Campaign objective: ${plan.objective.outcome || "(not set)"}`,
    plan.audience.who && `Target audience: ${plan.audience.who}${plan.audience.location ? ` (${plan.audience.location})` : ""}`,
    plan.offer.promoting && `Offer: ${plan.offer.promoting}`,
    plan.offer.benefit && `Main customer benefit: ${plan.offer.benefit}`,
    plan.offer.message && `Central message: ${plan.offer.message}`,
    plan.offer.cta && `Call to action: ${plan.offer.cta}`,
    plan.offer.requirements && `Must include or verify (do not invent facts): ${plan.offer.requirements}`,
    `Platform and format: ${[d.channel, d.format].filter(Boolean).join(" - ") || "not specified"}`,
    d.brief && `Brief for this piece: ${d.brief}`,
    input.feedback && `Reviewer feedback to address: ${input.feedback}`,
  ].filter(Boolean);
  const isImage = d.type !== "email";
  return `${isImage ? "Create an image" : "Write copy"} for ${input.brandName}: ${d.title}.\n\n${lines.join("\n")}\n\nUse only facts stated above. Do not invent prices, dates, availability or claims.`;
}

/** True when the target number the model claims is "user"/"historical" actually appears in what the user gave us. */
export function groundTargetBasis(
  basis: string,
  targetValue: string,
  userText: string,
): "user" | "historical" | "estimate" | "unknown" {
  const b = (["user", "historical", "estimate", "unknown"] as const).find((x) => x === basis) ?? "unknown";
  if (!targetValue.trim()) return b === "user" || b === "historical" ? "unknown" : b;
  if (b === "user" || b === "historical") {
    const digits = targetValue.replace(/[^0-9.]/g, "");
    return digits && userText.replace(/,/g, "").includes(digits) ? b : "estimate";
  }
  return b;
}
