"use client";

import { useState } from "react";
import { Loader2, Plus, SkipForward, Trash2 } from "lucide-react";
import {
  REEL_MAX_SECONDS,
  REEL_MIN_SECONDS,
  VIDEO_MODELS,
  type ReelPlanItemDto,
  type ReelPlanStatus,
  type VideoModelId,
} from "@catgpt/types";
import { ApiRequestError } from "@/lib/api";
import { useSocialAccounts } from "@/lib/hooks";
import { useCreateReelPlan, useReelPlan, useRemovePlanItem, useSkipPlanItem } from "@/lib/video-hooks";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PLAN_LABEL: Record<ReelPlanStatus, string> = {
  planned: "Planned",
  producing: "Making reel",
  ready: "Ready to approve",
  approved: "Approved, posting queued",
  posted: "Queued to post",
  failed: "Needs attention",
  skipped: "Skipped",
};

const errorText = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

/** Local date-time text ("2026-10-27T18:30") to an ISO instant. */
const toIso = (local: string) => new Date(local).toISOString();

/** The planned reels for a brand. The autopilot makes each one ahead of its post time; nothing posts until it is approved. */
export function ReelPlanPanel({ brandId, folderId }: { brandId: string; folderId: string | null }) {
  const plan = useReelPlan(brandId);
  const [adding, setAdding] = useState(false);
  const skip = useSkipPlanItem();
  const remove = useRemovePlanItem();

  const onSkip = async (item: ReelPlanItemDto) => {
    try {
      await skip.mutateAsync(item);
    } catch (err) {
      toast.error(errorText(err, "Could not skip this reel"));
    }
  };

  const onRemove = async (item: ReelPlanItemDto) => {
    if (!window.confirm(`Remove "${item.title}" from the plan?`)) return;
    try {
      await remove.mutateAsync(item);
    } catch (err) {
      toast.error(errorText(err, "Could not remove this reel"));
    }
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold">Plan</h3>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAdding((v) => !v)}>
          <Plus /> Plan a reel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Reels are made a day ahead of their post time. You approve each one before it is queued.
      </p>

      {adding && (
        <PlanForm
          brandId={brandId}
          folderId={folderId}
          onDone={() => setAdding(false)}
        />
      )}

      {plan.data?.length === 0 && !adding && <p className="text-sm text-muted-foreground">Nothing planned yet.</p>}

      <ul className="space-y-2">
        {plan.data?.map((item) => (
          <li key={item.id} className="space-y-1 rounded-md border p-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{item.title}</span>
              <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs", STATUS_TONE[item.status])}>
                {PLAN_LABEL[item.status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Posts {new Date(item.postAt).toLocaleString()} · {item.brief.durationSec}s · {item.accountIds.length} account
              {item.accountIds.length === 1 ? "" : "s"}
            </div>
            {item.error && <div className="text-xs text-destructive">{item.error}</div>}
            <div className="flex gap-1 pt-1">
              {item.status === "planned" && (
                <Button size="sm" variant="ghost" onClick={() => void onSkip(item)}>
                  <SkipForward /> Skip
                </Button>
              )}
              {["planned", "skipped", "failed", "ready"].includes(item.status) && (
                <Button size="sm" variant="ghost" onClick={() => void onRemove(item)} aria-label={`Remove ${item.title}`}>
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_TONE: Record<ReelPlanStatus, string> = {
  planned: "bg-muted",
  producing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  ready: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

function PlanForm({ brandId, folderId, onDone }: { brandId: string; folderId: string | null; onDone: () => void }) {
  const create = useCreateReelPlan();
  const accounts = useSocialAccounts(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [postLocal, setPostLocal] = useState("");
  const [durationSec, setDurationSec] = useState(15);
  const [videoModel, setVideoModel] = useState("veo-3.1-lite");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [caption, setCaption] = useState("");

  const canSave = title.trim() && goal.trim().length >= 3 && postLocal && accountIds.length > 0 && !create.isPending;

  const submit = async () => {
    try {
      await create.mutateAsync({
        brandId,
        items: [
          {
            title: title.trim(),
            folderId,
            brief: {
              goal: goal.trim(),
              durationSec,
              aspectRatio: "9:16",
              resolution: "720p",
              videoModel: videoModel as VideoModelId,
              voiceProvider: "none",
              voiceId: null,
            },
            postAt: toIso(postLocal),
            accountIds,
            caption: caption.trim() || null,
          },
        ],
      });
      toast.success("Planned. It will be made a day before it posts.");
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Could not add this reel to the plan"));
    }
  };

  const toggle = (id: string) =>
    setAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={120} />
      <Textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="What should this reel do?"
        rows={2}
        maxLength={500}
      />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2 space-y-1">
          <span className="text-xs text-muted-foreground">Post at</span>
          <Input type="datetime-local" value={postLocal} onChange={(e) => setPostLocal(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Length (seconds)</span>
          <Input
            type="number"
            min={REEL_MIN_SECONDS}
            max={REEL_MAX_SECONDS}
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Video model</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2"
            value={videoModel}
            onChange={(e) => setVideoModel(e.target.value)}
          >
            {VIDEO_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Post to</span>
        {accounts.data?.length === 0 && <p className="text-xs text-muted-foreground">Connect a social account first.</p>}
        <ul className="space-y-1">
          {accounts.data?.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={accountIds.includes(a.id)} onChange={() => toggle(a.id)} />
                <span>
                  {a.platform} · {a.displayName ?? a.handle ?? "account"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <Textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Caption (optional; defaults to the script's hook and call to action)"
        rows={2}
        maxLength={2200}
      />
      <Button onClick={() => void submit()} disabled={!canSave} className="w-full">
        {create.isPending ? <Loader2 className="animate-spin" /> : null} Add to plan
      </Button>
    </div>
  );
}
