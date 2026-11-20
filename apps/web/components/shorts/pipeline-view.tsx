"use client";

import { useState } from "react";
import type { ShortsStatus, ShortsVideoDto } from "@catgpt/types";
import { ShortsShell, fmtNum, fmtWhen } from "@/components/shorts/shorts-shell";
import { StatusBadge, VideoActions, VideoDetailDialog } from "@/components/shorts/video-detail";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useShortsChannels, useShortsVideos } from "@/lib/shorts-hooks";

const GROUPS: { key: string; label: string; statuses: ShortsStatus[] }[] = [
  { key: "review", label: "Needs your review", statuses: ["awaiting_approval"] },
  { key: "making", label: "In production", statuses: ["idea", "scripted", "assets_ready", "rendered"] },
  { key: "posting", label: "Approved / scheduled / manual queue", statuses: ["approved", "scheduled", "manual_pending"] },
  { key: "posted", label: "Posted", statuses: ["posted", "manual_posted"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
];

export function ShortsPipelineView() {
  return (
    <ShortsShell current="pipeline">
      <Pipeline />
    </ShortsShell>
  );
}

function Pipeline() {
  const channels = useShortsChannels();
  const [channelId, setChannelId] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useShortsVideos({ channelId: channelId || undefined, dryRun });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-56" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Channel">
          <option value="">All channels</option>
          {channels.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={dryRun} onCheckedChange={setDryRun} /> Include dry runs
        </label>
      </div>
      {isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No videos yet. Use "Generate now" on a channel, or wait for the scheduler.</Card>
      ) : (
        GROUPS.map((g) => {
          const items = data.filter((v) => g.statuses.includes(v.status));
          if (!items.length) return null;
          return (
            <section key={g.key} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {g.label} <span className="text-muted-foreground">({items.length})</span>
              </h2>
              <div className="divide-y rounded-lg border">
                {items.map((v) => (
                  <Row key={v.id} v={v} onOpen={() => setOpen(v.id)} />
                ))}
              </div>
            </section>
          );
        })
      )}
      {open && <VideoDetailDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Row({ v, onOpen }: { v: ShortsVideoDto; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate font-medium hover:underline">{v.title ?? "(scripting...)"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {v.channelName} · Path {v.path}
          {v.plannedPath !== v.path ? ` (fallback from ${v.plannedPath})` : ""} · slot {fmtWhen(v.slotAt)}
          {v.durationSec ? ` · ${v.durationSec.toFixed(0)}s` : ""}
          {v.latestStats ? ` · ${fmtNum(v.latestStats.views)} views` : ""}
          {v.source === "dry_run" ? " · dry run" : ""}
        </div>
        {(v.error || v.manualReason) && <div className="truncate text-xs text-amber-500">{v.error ?? v.manualReason}</div>}
      </button>
      <StatusBadge status={v.status} />
      <VideoActions video={v} />
    </div>
  );
}
