"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import type { ShortsStatus, ShortsVideoDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useSetViewedPct, useShortsVideo, useVideoAction } from "@/lib/shorts-hooks";
import { fmtNum, fmtWhen } from "@/components/shorts/shorts-shell";

export const STATUS_LABEL: Record<ShortsStatus, string> = {
  idea: "Idea",
  scripted: "Scripted",
  assets_ready: "Assets ready",
  rendered: "Rendered",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  scheduled: "Scheduled on YouTube",
  posted: "Posted",
  manual_pending: "Manual queue",
  manual_posted: "Posted manually",
  failed: "Failed",
  rejected: "Rejected",
};

export function StatusBadge({ status }: { status: ShortsStatus }) {
  const variant =
    status === "failed" ? "destructive" : status === "posted" || status === "manual_posted" ? "secondary" : status === "awaiting_approval" || status === "manual_pending" ? "default" : "muted";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

/** Owner actions available for a video in its current state. */
export function VideoActions({ video, size = "sm" }: { video: ShortsVideoDto; size?: "sm" | "default" }) {
  const act = useVideoAction();
  const run = async (action: "approve" | "reject" | "retry" | "sync") => {
    try {
      await act.mutateAsync({ id: video.id, action });
      toast.success(action === "approve" ? "Approved: it will be posted or queued for manual posting" : action === "sync" ? "Stats synced" : "Done");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Action failed");
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {video.status === "awaiting_approval" && (
        <>
          <Button size={size} onClick={() => run("approve")} disabled={act.isPending}>
            Approve
          </Button>
          <Button size={size} variant="outline" onClick={() => run("reject")} disabled={act.isPending}>
            Reject
          </Button>
        </>
      )}
      {video.status === "failed" && (
        <Button size={size} variant="outline" onClick={() => run("retry")} disabled={act.isPending}>
          <RefreshCw /> Retry
        </Button>
      )}
      {video.youtubeVideoId && (
        <Button size={size} variant="ghost" onClick={() => run("sync")} disabled={act.isPending}>
          Sync stats
        </Button>
      )}
    </div>
  );
}

export function VideoDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: v, isLoading } = useShortsVideo(id);
  const setPct = useSetViewedPct();
  const [pct, setPctInput] = useState<string>("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        {isLoading || !v ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{v.title ?? "(no title yet)"}</DialogTitle>
              <DialogDescription>
                {v.channelName} · Path {v.path}
                {v.plannedPath !== v.path ? ` (planned ${v.plannedPath}, fell back)` : ""} · slot {fmtWhen(v.slotAt)}
                {v.source === "dry_run" ? " · DRY RUN (offline fixtures, never uploaded)" : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={v.status} />
              {v.synthetic && <Badge variant="outline">synthetic media disclosed</Badge>}
              {v.privateLocked && <Badge variant="destructive">locked private by YouTube</Badge>}
              <VideoActions video={v} />
            </div>
            {(v.error || v.manualReason) && (
              <div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>{v.error ?? v.manualReason}</span>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-[240px_1fr]">
              <div>
                {v.fileUrl ? (
                  <video src={v.fileUrl} controls playsInline className="aspect-[9/16] w-full rounded-md bg-black" />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">No render yet</div>
                )}
                {v.youtubeUrl && (
                  <a href={v.youtubeUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 text-sm text-primary underline">
                    Open on YouTube <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="space-y-3 text-sm">
                {v.hook && (
                  <Section title={`Hook (${v.hookType ?? "?"})`}>
                    <p>{v.hook}</p>
                  </Section>
                )}
                {v.narration && (
                  <Section title={`Narration${v.durationSec ? ` · ${v.durationSec.toFixed(1)}s` : ""}`}>
                    <p className="whitespace-pre-wrap text-muted-foreground">{v.narration}</p>
                  </Section>
                )}
                {v.description && (
                  <Section title="Description">
                    <p className="whitespace-pre-wrap text-muted-foreground">{v.description}</p>
                  </Section>
                )}
                {v.tags.length > 0 && (
                  <Section title="Tags">
                    <div className="flex flex-wrap gap-1">
                      {v.tags.map((t) => (
                        <Badge key={t} variant="muted">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </Section>
                )}
                {v.youtubeVideoId && (
                  <Section title="Stats">
                    <p>
                      {v.latestStats
                        ? `${fmtNum(v.latestStats.views)} views · ${fmtNum(v.latestStats.likes)} likes · ${fmtNum(v.latestStats.comments)} comments (synced ${fmtWhen(v.latestStats.capturedAt)})`
                        : "Not synced yet"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Viewed vs swiped (from Studio, %)</span>
                      <Input
                        className="h-8 w-20"
                        inputMode="decimal"
                        placeholder={v.manualViewedPct?.toString() ?? "-"}
                        value={pct}
                        onChange={(e) => setPctInput(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setPct.isPending}
                        onClick={async () => {
                          const n = pct.trim() === "" ? null : Number(pct);
                          if (n !== null && (Number.isNaN(n) || n < 0 || n > 100)) return toast.error("Enter 0-100, or leave empty to clear");
                          await setPct.mutateAsync({ id: v.id, viewedPct: n });
                          setPctInput("");
                          toast.success("Saved");
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </Section>
                )}
              </div>
            </div>
            <Section title="Assets and licenses">
              <table className="w-full text-xs">
                <tbody>
                  {v.assets.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="py-1 pr-2">
                        {a.kind}
                        {a.beatIndex !== null ? ` #${a.beatIndex}` : ""}
                      </td>
                      <td className="pr-2">{a.provider}</td>
                      <td className="pr-2">{a.licenseUrl ? <a className="underline" href={a.licenseUrl} target="_blank" rel="noreferrer">{a.license}</a> : a.license}</td>
                      <td className="max-w-[220px] truncate">
                        {a.sourceUrl?.startsWith("http") ? (
                          <a className="underline" href={a.sourceUrl} target="_blank" rel="noreferrer">
                            {a.author ?? a.sourceUrl}
                          </a>
                        ) : (
                          (a.sourceUrl ?? a.providerAssetId ?? "-")
                        )}
                      </td>
                    </tr>
                  ))}
                  {v.assets.length === 0 && (
                    <tr>
                      <td className="text-muted-foreground">None yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>
            <Section title="History">
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                {v.events.map((e) => (
                  <li key={e.id} className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-amber-500" : "text-muted-foreground"}>
                    {fmtWhen(e.createdAt)} · {e.message}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
