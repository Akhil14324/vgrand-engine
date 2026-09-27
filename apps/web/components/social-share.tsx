"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  ExternalLink,
  ImageIcon,
  Loader2,
  Plus,
  RotateCw,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  SOCIAL_MAX_CAROUSEL_IMAGES,
  X_MAX_CHARS,
  type GenerationDto,
  type SocialAccountDto,
  type SocialFailureCode,
  type SocialPlatform,
  type SocialPostDto,
  type SocialPreviewsDto,
} from "@catgpt/types";
import {
  useConnectSocial,
  useApproveForCalendar,
  useBestTimes,
  useConversation,
  useCreateSocialPosts,
  useDeleteSocialAccount,
  useGenerations,
  useRetrySocialPost,
  useSocialAccounts,
  useSocialPlatforms,
  useSocialPosts,
  useSocialPreview,
  useWorkspaces,
} from "@/lib/hooks";
import { ApiRequestError } from "@/lib/api";
import { toast } from "@/components/ui/toaster";
import { useRewriteCaption } from "@/lib/brand-compliance-hooks";
import { cn } from "@/lib/utils";
import { useClickPulse } from "@/lib/use-click-pulse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PLATFORMS: { id: SocialPlatform; label: string; connector: "meta" | "x" | "youtube" }[] = [
  { id: "instagram", label: "Instagram", connector: "meta" },
  { id: "facebook", label: "Facebook", connector: "meta" },
  { id: "x", label: "X", connector: "x" },
  { id: "youtube", label: "YouTube", connector: "youtube" },
];
const LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
};

const FAILURE_LABEL: Record<SocialFailureCode, string> = {
  AUTH_EXPIRED: "Authorization expired",
  AUTH_REVOKED: "Authorization revoked",
  RATE_LIMITED: "Rate limited",
  INVALID_MEDIA: "Invalid image",
  INVALID_CONTENT: "Invalid content",
  PROVIDER_ERROR: "Provider error",
  UNKNOWN: "Something went wrong",
};

/** Format an instant for <input type="datetime-local"> in local time. */
function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const formatSlot = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Tomorrow 10:00 in local time, formatted for <input type="datetime-local">. */
export function defaultScheduleValue(day?: Date) {
  const d = day ? new Date(day) : new Date();
  if (!day) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Earliest pickable local time (matches the API's one-minute lead), for datetime-local min. */
export function minScheduleValue() {
  const d = new Date(Date.now() + 2 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const accountName = (a: Pick<SocialAccountDto, "handle" | "displayName" | "platform">) =>
  a.handle ?? a.displayName ?? LABEL[a.platform];

function Avatar({ account }: { account: SocialAccountDto }) {
  const [broken, setBroken] = useState(false);
  const initial = accountName(account).replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return account.avatarUrl && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={account.avatarUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="size-8 shrink-0 rounded-full object-cover"
    />
  ) : (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
      {initial}
    </div>
  );
}

/** Editable, removable chips (Instagram hashtags, YouTube tags). */
function TagEditor({
  tags,
  onChange,
  prefix = "",
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  prefix?: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.replace(/^#+/, "").trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input p-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary"
        >
          {prefix}
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={placeholder}
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-xs outline-none"
      />
    </div>
  );
}

function PostRow({
  post,
  workspaceId,
  generationId,
}: {
  post: SocialPostDto;
  workspaceId: string | null;
  generationId: string;
}) {
  const retry = useRetrySocialPost(generationId);
  const connect = useConnectSocial();
  const authFailure =
    post.failureCode === "AUTH_EXPIRED" ||
    post.failureCode === "AUTH_REVOKED" ||
    (post.status === "failed" && post.accountStatus === "reauth_required");
  const name = post.accountHandle ?? post.accountDisplayName ?? LABEL[post.platform];

  return (
    <li className="rounded-md border border-border p-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{LABEL[post.platform]}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{name}</span>
        {post.status === "scheduled" && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <CalendarClock className="size-3" />
            Scheduled {post.scheduledFor ? formatWhen(post.scheduledFor) : ""}
          </span>
        )}
        {(post.status === "pending" || post.status === "posting") && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {post.status === "pending"
              ? post.attemptCount > 0
                ? `Retrying (attempt ${post.attemptCount} failed)…`
                : "Queued…"
              : "Posting…"}
          </span>
        )}
        {post.status === "posted" && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <Check className="size-3" />
            {post.visibility === "private" ? "Posted (private)" : "Posted"}
          </span>
        )}
        {post.status === "failed" && (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <X className="size-3" />
            Failed
          </span>
        )}
      </div>

      {post.status === "pending" && post.attemptCount > 0 && post.error && (
        <p className="mt-1 text-xs text-muted-foreground">Last error: {post.error}</p>
      )}

      {post.status === "posted" && post.remoteUrl && (
        <a
          href={post.remoteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View post <ExternalLink className="size-3" />
        </a>
      )}
      {post.status === "posted" && post.visibility === "private" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          This video is private on YouTube - it is not public.
        </p>
      )}

      {post.status === "failed" && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs text-destructive">
            {post.failureCode ? FAILURE_LABEL[post.failureCode] : "Failed"}
            {post.error ? <span className="text-muted-foreground"> - {post.error}</span> : null}
          </p>
          <div className="flex gap-1.5">
            {authFailure && (
              <Button
                size="sm"
                variant="outline"
                disabled={connect.isPending}
                onClick={() =>
                  connect.mutate({
                    platform: post.platform,
                    workspaceId,
                  })
                }
              >
                Reconnect
              </Button>
            )}
            {post.retryable && (
              <Button
                size="sm"
                variant="outline"
                disabled={retry.isPending}
                onClick={() => retry.mutate(post.id)}
              >
                {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
                Retry
              </Button>
            )}
          </div>
          {retry.isError && <p className="text-xs text-destructive">{retry.error.message}</p>}
          {connect.isError && <p className="text-xs text-destructive">{connect.error.message}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * An image beyond the post's own first one, queued to join this post's
 * carousel — either another frame of a generation that already produced a
 * set, or another generation's image entirely.
 */
interface CarouselImage {
  generationId: string;
  index: number;
  url: string;
}

/** The post's own first image (locked, always first) plus any added extras - removable and reorderable. */
function PhotoStrip({
  primaryUrl,
  extras,
  onRemove,
  onMove,
}: {
  primaryUrl: string;
  extras: CarouselImage[];
  onRemove: (position: number) => void;
  onMove: (position: number, dir: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={primaryUrl} alt="" className="h-full w-full object-cover" />
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">1</span>
      </div>
      {extras.map((img, i) => (
        <div
          key={`${img.generationId}-${img.index}`}
          className="group relative size-16 shrink-0 overflow-hidden rounded-md border border-border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="" className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 2}</span>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              aria-label="Move earlier"
              disabled={i === 0}
              onClick={() => onMove(i, -1)}
              className="px-1 py-0.5 text-xs text-white disabled:opacity-30"
            >
              ←
            </button>
            <button
              type="button"
              aria-label={`Remove photo ${i + 2}`}
              onClick={() => onRemove(i)}
              className="px-1 py-0.5 text-white"
            >
              <X className="size-3" />
            </button>
            <button
              type="button"
              aria-label="Move later"
              disabled={i === extras.length - 1}
              onClick={() => onMove(i, 1)}
              className="px-1 py-0.5 text-xs text-white disabled:opacity-30"
            >
              →
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Picks up to `remaining` past generations' images (their first/only frame) to append to the carousel. */
function AddPhotosDialog({
  excludeIds,
  remaining,
  onAdd,
}: {
  excludeIds: Set<string>;
  remaining: number;
  onAdd: (img: CarouselImage) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGenerations();
  const options = useMemo(
    () =>
      (data?.items ?? []).filter(
        (g) => g.status === "completed" && g.imageUrls.length > 0 && !excludeIds.has(g.id),
      ),
    [data, excludeIds],
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={remaining <= 0}>
          <Plus />
          Add photo{remaining > 0 ? ` (${remaining} left)` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add photos to this post</DialogTitle>
          <DialogDescription>
            Pick up to {remaining} more image{remaining === 1 ? "" : "s"} from your past generations to build a
            carousel.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : options.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <ImageIcon className="size-6" />
            No other images to add yet.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {options.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.prompt}
                disabled={remaining <= 0}
                onClick={() => onAdd({ generationId: g.id, index: 0, url: g.imageUrls[0]! })}
                className="aspect-square overflow-hidden rounded-md border border-border hover:border-primary disabled:pointer-events-none disabled:opacity-40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.imageUrls[0]} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SocialShareBody({
  generation,
  initialWhen,
  onScheduled,
}: {
  generation: GenerationDto;
  /** datetime-local value; opens straight into the schedule step for that time. */
  initialWhen?: string;
  onScheduled?: () => void;
}) {
  const { data: conversation, isLoading: convLoading } = useConversation(
    generation.conversationId,
  );
  // The scope comes from the chat the image lives in: personal, or its workspace.
  const workspaceId = conversation?.workspaceId ?? null;
  const scopeReady = !generation.conversationId || !convLoading;
  const { data: workspaces } = useWorkspaces();
  const isOwner = !workspaceId || workspaces?.find((w) => w.id === workspaceId)?.role === "owner";

  const { data: platformsOn } = useSocialPlatforms();
  const { data: accounts, isLoading: accountsLoading } = useSocialAccounts(
    workspaceId,
    scopeReady,
  );
  const connect = useConnectSocial();
  const del = useDeleteSocialAccount();
  const preview = useSocialPreview(generation.id);
  const create = useCreateSocialPosts(generation.id);
  const { data: posts } = useSocialPosts(generation.id, true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<SocialPreviewsDto>({});
  // A generation that already produced a carousel set starts with its own
  // other frames pre-loaded; the user can still remove or reorder them.
  const [extraImages, setExtraImages] = useState<CarouselImage[]>(() =>
    generation.imageUrls.slice(1).map((url, i) => ({ generationId: generation.id, index: i + 1, url })),
  );

  const selectedAccounts = useMemo(
    () => (accounts ?? []).filter((a) => selected.has(a.id)),
    [accounts, selected],
  );
  const neededPlatforms = useMemo(
    () => [...new Set(selectedAccounts.map((a) => a.platform))],
    [selectedAccounts],
  );
  // Only Instagram and Facebook turn extra images into a carousel / multi-photo post.
  const carouselEligible = neededPlatforms.includes("instagram") || neededPlatforms.includes("facebook");
  const extraImageIds = useMemo(
    () => new Set([generation.id, ...extraImages.map((i) => i.generationId)]),
    [generation.id, extraImages],
  );
  const missing = neededPlatforms.filter((p) => !drafts[p]);
  const hasAllDrafts = neededPlatforms.length > 0 && missing.length === 0;

  const problems: string[] = [];
  if (drafts.instagram && neededPlatforms.includes("instagram") && !drafts.instagram.caption.trim())
    problems.push("Instagram needs a caption");
  if (drafts.facebook && neededPlatforms.includes("facebook") && !drafts.facebook.caption.trim())
    problems.push("Facebook needs a caption");
  if (drafts.x && neededPlatforms.includes("x")) {
    if (!drafts.x.caption.trim()) problems.push("X needs post text");
    if (drafts.x.caption.length > X_MAX_CHARS) problems.push(`X is limited to ${X_MAX_CHARS} characters`);
  }
  if (drafts.youtube && neededPlatforms.includes("youtube") && !drafts.youtube.title.trim())
    problems.push("YouTube needs a title");

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const generate = () => {
    // Fill only what is missing; when everything exists this regenerates all.
    const platforms = missing.length ? missing : neededPlatforms;
    preview.mutate(
      { platforms },
      { onSuccess: (res) => setDrafts((d) => ({ ...d, ...res })) },
    );
  };

  const [scheduling, setScheduling] = useState(!!initialWhen);
  const [when, setWhen] = useState(initialWhen ?? defaultScheduleValue());
  const bestTimes = useBestTimes(
    selectedAccounts.map((a) => a.id),
    initialWhen?.slice(0, 10),
    scheduling,
  );
  const scheduledDate = when ? new Date(when) : null;
  const scheduleValid =
    !!scheduledDate && !Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() > Date.now() + 60_000;

  // Brand rules: the server blocks copy with a forbidden word/claim unless overridden.
  const rewrite = useRewriteCaption();
  const [lastScheduledFor, setLastScheduledFor] = useState<string | undefined>();
  const brandId = typeof generation.metadata?.brandId === "string" ? generation.metadata.brandId : null;
  const blocked =
    create.error instanceof ApiRequestError && create.error.code === "COMPLIANCE_BLOCKED"
      ? ((create.error.details as { findings?: { id: string; detail: string }[] } | undefined)?.findings ?? [])
      : null;

  const fixWording = async () => {
    if (!brandId) return;
    const issues = (blocked ?? []).map((f) => f.detail);
    const next = { ...drafts };
    try {
      for (const platform of neededPlatforms) {
        const d = next[platform];
        if (!d) continue;
        const field = platform === "youtube" ? "description" : "caption";
        const text = (d as unknown as Record<string, string>)[field];
        if (!text?.trim()) continue;
        const res = await rewrite.mutateAsync({ brandId, caption: text, issues });
        (next as Record<string, unknown>)[platform] = { ...d, [field]: res.caption };
      }
      setDrafts(next);
      create.reset();
    } catch (e) {
      // Keep the warning visible so the user can edit by hand or post anyway.
      toast.error(e instanceof Error ? e.message : "Couldn't rewrite the copy");
    }
  };

  // Instant scale-pulse on click, so the button visibly reacts before the
  // "Posting…" mutation state ever renders.
  const { ref: postBtnRef, pulse: postPulse } = useClickPulse<HTMLButtonElement>();

  const post = (scheduledFor?: string, complianceOverride?: boolean) => {
    postPulse();
    setLastScheduledFor(scheduledFor);
    create.mutate(
      {
        posts: selectedAccounts.map((a) => {
          const d = drafts[a.platform]!;
          return { accountId: a.id, content: d as Record<string, unknown> };
        }),
        additionalImages: carouselEligible
          ? extraImages.map(({ generationId, index }) => ({ generationId, index }))
          : undefined,
        scheduledFor,
        complianceOverride,
      },
      {
        onSuccess: () => {
          setSelected(new Set());
          setDrafts({});
          // Back to the generation's own carousel set, not an empty strip.
          setExtraImages(
            generation.imageUrls.slice(1).map((url, i) => ({ generationId: generation.id, index: i + 1, url })),
          );
          setScheduling(!!initialWhen);
          if (scheduledFor) onScheduled?.();
        },
      },
    );
  };

  const youtubePrivate = (accounts ?? []).some(
    (a) => a.platform === "youtube" && a.metadata?.visibility !== "public",
  );
  const noneConfigured =
    platformsOn && !platformsOn.meta && !platformsOn.x && !platformsOn.youtube;

  if (!scopeReady || accountsLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Posting as{" "}
        {workspaceId ? (
          <>this workspace{conversation?.workspace ? ` (${conversation.workspace.name})` : ""} and you</>
        ) : (
          "you"
        )}
        .
      </p>
      {noneConfigured && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Social publishing isn&apos;t configured on this server yet.
        </p>
      )}

      {/* Step 1: accounts */}
      <div className="space-y-3">
        {PLATFORMS.map(({ id, label, connector }) => {
          const list = (accounts ?? []).filter((a) => a.platform === id);
          const configured = platformsOn?.[connector] ?? false;
          const canConnect = configured && isOwner;
          return (
            <section key={id}>
              <h3 className="mb-1.5 text-sm font-medium">{label}</h3>
              <ul className="space-y-1.5">
                {list.map((a) => {
                  const needsReauth = a.status === "reauth_required" || a.status === "revoked";
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-2.5 rounded-md border border-border p-2"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selected.has(a.id)}
                        disabled={needsReauth}
                        onChange={() => toggle(a.id)}
                        aria-label={`Post to ${accountName(a)}`}
                      />
                      <Avatar account={a} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{accountName(a)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {label}
                          {a.workspaceId ? " · shared workspace account" : " · personal"}
                          {a.platform === "youtube" && a.metadata?.visibility !== "public"
                            ? " · private uploads only"
                            : ""}
                        </div>
                      </div>
                      {needsReauth && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={connect.isPending || !canConnect}
                          onClick={() => connect.mutate({ platform: id, workspaceId: a.workspaceId })}
                        >
                          Reconnect
                        </Button>
                      )}
                      {(!a.workspaceId || isOwner) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Disconnect ${accountName(a)}`}
                              className="text-muted-foreground hover:text-destructive"
                              disabled={del.isPending}
                              onClick={() => {
                                if (window.confirm(`Disconnect ${accountName(a)}?`)) {
                                  setSelected((s) => {
                                    const next = new Set(s);
                                    next.delete(a.id);
                                    return next;
                                  });
                                  del.mutate(a.id);
                                }
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Disconnect</TooltipContent>
                        </Tooltip>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-1.5">
                {configured ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={connect.isPending || !isOwner}
                    onClick={() => connect.mutate({ platform: id, workspaceId })}
                  >
                    <Plus />
                    {list.length ? `Add ${label} account` : `Connect ${label}`}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {label} isn&apos;t configured on this server
                  </span>
                )}
                {configured && !isOwner && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Only the workspace owner can connect accounts
                  </span>
                )}
              </div>
            </section>
          );
        })}
        {connect.isError && <p className="text-xs text-destructive">{connect.error.message}</p>}
        {del.isError && <p className="text-xs text-destructive">{del.error.message}</p>}
      </div>

      {youtubePrivate && neededPlatforms.includes("youtube") && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          YouTube posts will be <strong>private</strong> while this app&apos;s Google
          verification is pending - they won&apos;t be public.
        </p>
      )}

      {carouselEligible && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Photos</h3>
          <PhotoStrip
            primaryUrl={generation.imageUrls[0]!}
            extras={extraImages}
            onRemove={(position) => setExtraImages((imgs) => imgs.filter((_, i) => i !== position))}
            onMove={(index, dir) =>
              setExtraImages((imgs) => {
                const next = [...imgs];
                const swapWith = index + dir;
                if (swapWith < 0 || swapWith >= next.length) return imgs;
                [next[index], next[swapWith]] = [next[swapWith]!, next[index]!];
                return next;
              })
            }
          />
          <AddPhotosDialog
            excludeIds={extraImageIds}
            remaining={SOCIAL_MAX_CAROUSEL_IMAGES - 1 - extraImages.length}
            onAdd={(img) => setExtraImages((imgs) => [...imgs, img])}
          />
          {extraImages.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Instagram and Facebook will post these {1 + extraImages.length} photos as one carousel; other
              selected platforms only use the first.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          onClick={generate}
          disabled={neededPlatforms.length === 0 || preview.isPending}
          variant={hasAllDrafts ? "outline" : "default"}
        >
          {preview.isPending && <Loader2 className="animate-spin" />}
          {hasAllDrafts ? "Regenerate preview" : "Generate preview"}
        </Button>
        {neededPlatforms.length === 0 && (
          <span className="text-xs text-muted-foreground">Select at least one account</span>
        )}
      </div>
      {preview.isError && <p className="text-xs text-destructive">{preview.error.message}</p>}

      {/* Step 2: editable previews */}
      {neededPlatforms.includes("instagram") && drafts.instagram && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">Instagram</h3>
          <label className="text-xs text-muted-foreground">Caption</label>
          <Textarea
            value={drafts.instagram.caption}
            onChange={(e) =>
              setDrafts((d) => ({ ...d, instagram: { ...d.instagram!, caption: e.target.value } }))
            }
            className="min-h-[90px]"
          />
          <label className="text-xs text-muted-foreground">Hashtags</label>
          <TagEditor
            tags={drafts.instagram.hashtags}
            prefix="#"
            placeholder="Add hashtag"
            onChange={(hashtags) =>
              setDrafts((d) => ({ ...d, instagram: { ...d.instagram!, hashtags } }))
            }
          />
        </section>
      )}
      {neededPlatforms.includes("facebook") && drafts.facebook && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">Facebook</h3>
          <Textarea
            value={drafts.facebook.caption}
            onChange={(e) => setDrafts((d) => ({ ...d, facebook: { caption: e.target.value } }))}
            className="min-h-[90px]"
          />
        </section>
      )}
      {neededPlatforms.includes("x") && drafts.x && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">X</h3>
          <Textarea
            value={drafts.x.caption}
            onChange={(e) => setDrafts((d) => ({ ...d, x: { caption: e.target.value } }))}
            className="min-h-[70px]"
          />
          <div
            className={cn(
              "text-right text-[11px]",
              drafts.x.caption.length > X_MAX_CHARS ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {drafts.x.caption.length}/{X_MAX_CHARS}
          </div>
        </section>
      )}
      {neededPlatforms.includes("youtube") && drafts.youtube && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">YouTube</h3>
          <label className="text-xs text-muted-foreground">Title</label>
          <Input
            value={drafts.youtube.title}
            maxLength={100}
            onChange={(e) =>
              setDrafts((d) => ({ ...d, youtube: { ...d.youtube!, title: e.target.value } }))
            }
          />
          <label className="text-xs text-muted-foreground">Description</label>
          <Textarea
            value={drafts.youtube.description}
            onChange={(e) =>
              setDrafts((d) => ({ ...d, youtube: { ...d.youtube!, description: e.target.value } }))
            }
            className="min-h-[90px]"
          />
          <label className="text-xs text-muted-foreground">Tags</label>
          <TagEditor
            tags={drafts.youtube.tags}
            placeholder="Add tag"
            onChange={(tags) => setDrafts((d) => ({ ...d, youtube: { ...d.youtube!, tags } }))}
          />
          <p className="text-[11px] text-muted-foreground">
            The image is turned into an 8-second video for YouTube.
          </p>
        </section>
      )}

      {hasAllDrafts && (
        <div className="space-y-1.5">
          {problems.map((p) => (
            <p key={p} className="text-xs text-destructive">
              {p}
            </p>
          ))}
          {scheduling && (
            <div className="space-y-1.5 rounded-md border border-border p-2.5">
              <label className="text-xs text-muted-foreground" htmlFor="schedule-at">
                Date &amp; time to publish ({Intl.DateTimeFormat().resolvedOptions().timeZone})
              </label>
              <Input
                id="schedule-at"
                type="datetime-local"
                min={minScheduleValue()}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
              {bestTimes.data && bestTimes.data.length > 0 && (
                <div className="space-y-1 pt-0.5">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Sparkles className="size-3" />
                    Suggested times
                    <span className="opacity-70">(general platform patterns, not your own stats)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {bestTimes.data.map((slot, i) => {
                      const value = toLocalInputValue(new Date(slot.at));
                      return (
                        <Button
                          key={slot.at}
                          type="button"
                          size="sm"
                          variant={value === when ? "default" : "outline"}
                          className="h-7 px-2 text-xs"
                          title={slot.platforms.length ? `Strong for ${slot.platforms.map((p) => LABEL[p]).join(", ")}` : undefined}
                          onClick={() => setWhen(value)}
                        >
                          {formatSlot(slot.at)}
                          {i === 0 && <span className="ml-1 opacity-70">· best</span>}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!scheduleValid && (
                <p className="text-xs text-destructive">Pick a time in the future - past times can't be scheduled</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {scheduling ? (
              <>
                <Button
                  onClick={() => post(scheduledDate!.toISOString())}
                  disabled={create.isPending || problems.length > 0 || !scheduleValid}
                >
                  {create.isPending && <Loader2 className="animate-spin" />}
                  <CalendarClock />
                  Schedule post
                </Button>
                <Button variant="ghost" onClick={() => setScheduling(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button ref={postBtnRef} onClick={() => post()} disabled={create.isPending || problems.length > 0}>
                  {create.isPending && <Loader2 className="animate-spin" />}
                  Post now to {selectedAccounts.length} account{selectedAccounts.length === 1 ? "" : "s"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setScheduling(true)}
                  disabled={create.isPending || problems.length > 0}
                >
                  <CalendarClock />
                  Schedule
                </Button>
              </>
            )}
          </div>
          {blocked ? (
            <div className="space-y-2 rounded-md border border-destructive/40 p-2.5 text-xs">
              <p className="font-medium text-destructive">This copy breaks your brand rules</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {blocked.map((f) => (
                  <li key={f.id}>{f.detail}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {brandId && (
                  <Button size="sm" onClick={fixWording} disabled={rewrite.isPending}>
                    {rewrite.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Fix wording with AI
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => post(lastScheduledFor, true)} disabled={create.isPending}>
                  Post anyway
                </Button>
              </div>
              <p className="text-muted-foreground">Posting anyway is recorded against the brand.</p>
            </div>
          ) : (
            create.isError && <p className="text-xs text-destructive">{create.error.message}</p>
          )}
        </div>
      )}

      {/* Step 3: status */}
      {posts && posts.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">Posts</h3>
          <ul className="space-y-1.5">
            {posts.map((p) => (
              <PostRow key={p.id} post={p} workspaceId={workspaceId} generationId={generation.id} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Controlled publishing dialog, e.g. opened from the Social Calendar for a chosen day. */
export function SocialShareDialog({
  generation,
  open,
  onOpenChange,
  initialWhen,
  onScheduled,
}: {
  generation: GenerationDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialWhen?: string;
  onScheduled?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Social Sharing</DialogTitle>
          <DialogDescription>Pick accounts, preview the copy, edit it, then post or schedule.</DialogDescription>
        </DialogHeader>
        {open && <SocialShareBody generation={generation} initialWhen={initialWhen} onScheduled={onScheduled} />}
      </DialogContent>
    </Dialog>
  );
}

/** Share icon for the ActionRow + the publishing dialog it opens. */
export function SocialShareButton({ generation }: { generation: GenerationDto }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Post to social media">
              <Share2 />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Post to social media</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Social Sharing</DialogTitle>
          <DialogDescription>
            Pick accounts, preview the copy, edit it, then post.
          </DialogDescription>
        </DialogHeader>
        {open && <SocialShareBody generation={generation} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Approve for socials": puts the image on the Social Calendar (on the day it was
 * created) as an approved draft. It's scheduled for a future date from there.
 */
export function CalendarApproveButton({ generation }: { generation: GenerationDto }) {
  const approve = useApproveForCalendar();
  if (approve.isSuccess) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon" aria-label="Approved - open Social Calendar">
            <Link href="/calendar">
              <Check className="text-primary" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Approved for socials - open the calendar to schedule it</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Approve for socials"
          disabled={approve.isPending}
          onClick={() => approve.mutate(generation.id)}
        >
          {approve.isPending ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {approve.isError ? approve.error.message : "Approve for socials - adds it to your calendar"}
      </TooltipContent>
    </Tooltip>
  );
}
