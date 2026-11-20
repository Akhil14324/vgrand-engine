"use client";

import { useState } from "react";
import { Pencil, Youtube } from "lucide-react";
import {
  SHORTS_PATHS,
  SHORTS_PATH_LABELS,
  type ShortsChannelDto,
  type ShortsPath,
  type UpdateShortsChannelRequest,
} from "@catgpt/types";
import { ShortsShell } from "@/components/shorts/shorts-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useShortsChannels, useShortsHealth, useUpdateShortsChannel } from "@/lib/shorts-hooks";
import { YoutubeConnect } from "@/components/shorts/youtube-connect";

export function ShortsChannelsView() {
  return (
    <ShortsShell current="channels">
      <Channels />
    </ShortsShell>
  );
}

function Channels() {
  const { data, isLoading } = useShortsChannels();
  const health = useShortsHealth();
  const [editing, setEditing] = useState<ShortsChannelDto | null>(null);
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  const tz = health.data?.timezone ?? "Asia/Kolkata";
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Posting times are in <span className="font-medium text-foreground">{tz}</span>. Approval stays manual until you switch a
        channel to auto here.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {data.map((c) => (
          <ChannelCard key={c.id} channel={c} onEdit={() => setEditing(c)} />
        ))}
      </div>
      {editing && <EditChannelDialog channel={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ChannelCard({ channel: c, onEdit }: { channel: ShortsChannelDto; onEdit: () => void }) {
  const update = useUpdateShortsChannel();
  const posted = (c.counts.posted ?? 0) + (c.counts.manual_posted ?? 0);
  const waiting = c.counts.awaiting_approval ?? 0;
  const manual = c.counts.manual_pending ?? 0;
  const failed = c.counts.failed ?? 0;

  const setApproval = async (auto: boolean) => {
    if (auto && !window.confirm(`Switch ${c.displayName} to auto approval? New videos will be scheduled without your review.`)) return;
    try {
      await update.mutateAsync({ id: c.id, patch: { approvalMode: auto ? "auto" : "manual" } });
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not change approval mode");
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{c.displayName}</h3>
            <Badge variant="outline" title={SHORTS_PATH_LABELS[c.path]}>
              Path {c.path}
              {c.fallbackPath ? ` → ${c.fallbackPath}` : ""}
            </Badge>
            {!c.enabled && <Badge variant="muted">paused</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {c.slug} · {c.niche}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${c.displayName}`}>
          <Pencil />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Schedule</div>
          {c.videosPerDay}/day at {c.postingTimes.join(", ") || "-"}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Voice</div>
          <span className="font-mono text-xs">{c.voiceId ?? (c.path === "A" ? "n/a" : "server default")}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="secondary">{posted} posted</Badge>
        {waiting > 0 && <Badge>{waiting} awaiting approval</Badge>}
        {manual > 0 && <Badge variant="outline">{manual} in manual queue</Badge>}
        {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={c.approvalMode === "auto"} onCheckedChange={setApproval} disabled={update.isPending} />
          {c.approvalMode === "auto" ? "Auto approval" : "Manual approval"}
        </label>
        <div className="flex items-center gap-2 text-sm">
          <Youtube className="h-4 w-4" />
          <YoutubeConnect channel={c} />
        </div>
      </div>
    </Card>
  );
}

const csv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function EditChannelDialog({ channel: c, onClose }: { channel: ShortsChannelDto; onClose: () => void }) {
  const update = useUpdateShortsChannel();
  const [displayName, setDisplayName] = useState(c.displayName);
  const [niche, setNiche] = useState(c.niche);
  const [path, setPath] = useState<ShortsPath>(c.path);
  const [fallbackPath, setFallbackPath] = useState<ShortsPath | "">(c.fallbackPath ?? "");
  const [times, setTimes] = useState(c.postingTimes.join(", "));
  const [voiceId, setVoiceId] = useState(c.voiceId ?? "");
  const [tone, setTone] = useState(c.styleNotes.tone ?? "");
  const [hooks, setHooks] = useState((c.styleNotes.hookPatterns ?? []).join(", "));
  const [banned, setBanned] = useState((c.styleNotes.bannedTopics ?? []).join(", "));
  const [extra, setExtra] = useState(c.styleNotes.extra ?? "");
  const [keywords, setKeywords] = useState(c.stockKeywords.join(", "));
  const [enabled, setEnabled] = useState(c.enabled);

  const save = async () => {
    const postingTimes = csv(times);
    const patch: UpdateShortsChannelRequest = {
      displayName,
      niche,
      path,
      fallbackPath: fallbackPath || null,
      postingTimes,
      videosPerDay: postingTimes.length,
      voiceId: voiceId.trim() || null,
      styleNotes: { tone, hookPatterns: csv(hooks), bannedTopics: csv(banned), extra: extra || undefined },
      stockKeywords: csv(keywords),
      enabled,
    };
    try {
      await update.mutateAsync({ id: c.id, patch });
      toast.success("Channel saved");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not save the channel");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {c.displayName}</DialogTitle>
          <DialogDescription>
            Videos per day follows the number of posting times. Separate lists with commas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Niche">
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Path">
              <Select value={path} onChange={(e) => setPath(e.target.value as ShortsPath)}>
                {SHORTS_PATHS.map((p) => (
                  <option key={p} value={p}>
                    {SHORTS_PATH_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fallback path">
              <Select value={fallbackPath} onChange={(e) => setFallbackPath(e.target.value as ShortsPath | "")}>
                <option value="">None</option>
                <option value="B">{SHORTS_PATH_LABELS.B}</option>
                <option value="C">{SHORTS_PATH_LABELS.C}</option>
              </Select>
            </Field>
          </div>
          <Field label="Posting times (HH:MM, 24h)">
            <Input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="09:00, 18:30" />
          </Field>
          <Field label="ElevenLabs voice id (blank = server default)">
            <Input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} />
          </Field>
          <Field label="Tone">
            <Input value={tone} onChange={(e) => setTone(e.target.value)} />
          </Field>
          <Field label="Hook patterns">
            <Input value={hooks} onChange={(e) => setHooks(e.target.value)} />
          </Field>
          <Field label="Banned topics">
            <Textarea rows={2} value={banned} onChange={(e) => setBanned(e.target.value)} />
          </Field>
          <Field label="Other style notes">
            <Textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
          <Field label="Stock search keyword seeds">
            <Textarea rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} /> Channel enabled (scheduler produces videos)
          </label>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
