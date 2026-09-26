"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Flag, Loader2, Send, Sparkles } from "lucide-react";
import {
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_TYPE_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type DeliverableDto,
  type ExecEventDto,
  type ExecTaskDto,
  type PersonDto,
  type PublishingState,
} from "@catgpt/types";
import { Labeled, fmtDateTime, fmtDay } from "@/components/camp-shell";
import { SocialShareDialog } from "@/components/social-share";
import { useDeliverable, useDeliverableMutation, useGenerateForDeliverable, useTask, useTaskMutation } from "@/lib/bcamp-hooks";
import { useGeneration } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

export function publishingBadge(p: PublishingState): { label: string; variant: "default" | "secondary" | "muted" | "destructive" | "outline" } {
  switch (p.kind) {
    case "published":
      return { label: "Published", variant: "default" };
    case "scheduled":
      return { label: p.at ? `Scheduled ${fmtDay(p.at)}` : "Publishing", variant: "secondary" };
    case "failed":
      return { label: "Publishing failed", variant: "destructive" };
    case "manual":
      return { label: "Manual publishing required", variant: "outline" };
    case "not_connected":
      return { label: `${p.platform} not connected`, variant: "outline" };
    case "reauth_required":
      return { label: `${p.platform}: permission required`, variant: "destructive" };
    case "ready":
      return { label: "Ready to publish", variant: "default" };
    case "blocked_by_approval":
      return { label: "Not approved yet", variant: "muted" };
  }
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const errToast = (e: Error) => toast.error(e.message);

function History({ events, onComment, pending }: { events: ExecEventDto[]; onComment: (note: string) => void; pending: boolean }) {
  const [note, setNote] = useState("");
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">Updates and history</h4>
      <div className="flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an update or comment" />
        <Button
          size="icon"
          variant="outline"
          aria-label="Post comment"
          disabled={!note.trim() || pending}
          onClick={() => {
            onComment(note.trim());
            setNote("");
          }}
        >
          <Send />
        </Button>
      </div>
      <ul className="space-y-1 text-xs">
        {events.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className="w-28 shrink-0 text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
            <span>
              <span className="font-medium">{e.userName ?? "System"}</span> <span className="text-muted-foreground">{e.kind.replace(/_/g, " ")}</span>
              {e.note ? `: ${e.note}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlagBox({ flagged, onFlag }: { flagged: boolean; onFlag: (flagged: boolean, reason?: string) => void }) {
  const [reason, setReason] = useState("");
  if (flagged)
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-500/40 p-2 text-sm">
        <Flag className="h-4 w-4 text-amber-500" />
        <span className="flex-1">Flagged for strategic review in B Camp.</span>
        <Button size="sm" variant="outline" onClick={() => onFlag(false)}>
          Clear flag
        </Button>
      </div>
    );
  return (
    <div className="space-y-1">
      <Labeled label="Something stopping this from working?" hint="Flag it and B Camp will show it, with your reason, when the strategy is reviewed.">
        <div className="flex gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is the problem?" />
          <Button size="sm" variant="outline" disabled={!reason.trim()} onClick={() => onFlag(true, reason.trim())}>
            <Flag /> Flag for review
          </Button>
        </div>
      </Labeled>
    </div>
  );
}

/* ------------------------------- deliverable ------------------------------- */

export function DeliverableDialog({ id, members, canManage, onClose }: { id: string; members: PersonDto[]; canManage: boolean; onClose: () => void }) {
  const { data: d } = useDeliverable(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {!d ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <DeliverableBody d={d} members={members} canManage={canManage} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeliverableBody({ d, members, canManage }: { d: DeliverableDto; members: PersonDto[]; canManage: boolean }) {
  const mut = useDeliverableMutation(d.id);
  const gen = useGenerateForDeliverable(d.id);
  const { data: generation } = useGeneration(d.generationId);
  const [brief, setBrief] = useState(d.brief);
  const [note, setNote] = useState("");
  const [manual, setManual] = useState<{ note: string; url: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const pub = publishingBadge(d.publishing);
  const run = (c: Parameters<typeof mut.mutate>[0], ok?: string) => mut.mutate(c, { onSuccess: () => ok && toast.success(ok), onError: errToast });
  const busy = mut.isPending || gen.isPending;
  const closed = d.status === "completed" || d.status === "cancelled";
  const canSubmit = ["planned", "drafting", "changes_requested"].includes(d.status) && (!d.canGenerate || !!d.generationId);
  const publishable = ["ready", "not_connected", "reauth_required", "failed"].includes(d.publishing.kind) && !!d.generationId;

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="pr-6">{d.title}</DialogTitle>
        <DialogDescription>
          {DELIVERABLE_TYPE_LABELS[d.type]}
          {d.channel ? ` · ${d.channel}` : ""} ·{" "}
          <Link href={`/bcamp?strategy=${d.strategyId}`} className="text-primary hover:underline">
            {d.strategyTitle}
          </Link>
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Badge>{DELIVERABLE_STATUS_LABELS[d.status]}</Badge>
        <Badge variant={pub.variant}>{pub.label}</Badge>
        {d.dueAt && <span className="text-xs text-muted-foreground">Due {fmtDay(d.dueAt)}</span>}
        {d.overdue && <Badge variant="destructive">Overdue</Badge>}
      </div>

      {d.status === "changes_requested" && d.decisionNote && (
        <p className="rounded-md border border-amber-500/40 p-3 text-sm">
          <span className="font-medium">Changes requested:</span> {d.decisionNote}
        </p>
      )}
      {d.clientReview && (
        <p className="text-xs text-muted-foreground">
          Client review link: {d.clientReview.status.replace(/_/g, " ")}
          {d.clientReview.comment ? ` - "${d.clientReview.comment}"` : ""}
        </p>
      )}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Content</h4>
        {d.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.imageUrl} alt={d.title} className="max-h-72 rounded-md border object-contain" />
        ) : d.generationId ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Being generated…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {d.canGenerate ? "Nothing generated yet. The campaign brief, audience, offer and brand rules are filled in for you." : "This is produced outside the platform. Follow the brief, then submit it for approval."}
          </p>
        )}
        {d.captionPreview && <p className="rounded-md bg-muted p-2 text-sm">{d.captionPreview}</p>}
        {d.previousGenerationId && <p className="text-xs text-muted-foreground">This replaces an earlier version. The earlier version is kept in your Library.</p>}
        {d.canGenerate && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => gen.mutate(undefined, { onError: errToast })}>
            {gen.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {d.generationId ? "Regenerate from the brief" : "Generate from the campaign brief"}
          </Button>
        )}
      </section>

      <section className="space-y-2">
        <Labeled label="Brief" hint={d.status === "approved" ? "Reopen to change an approved item." : undefined}>
          <Textarea rows={3} value={brief} disabled={!canManage || d.status === "approved" || closed} onChange={(e) => setBrief(e.target.value)} />
        </Labeled>
        {canManage && brief !== d.brief && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ path: "", method: "PATCH", json: { brief } }, "Brief saved")}>
            Save brief
          </Button>
        )}
      </section>

      {canManage && !closed && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Owner">
            <Select value={d.assignee?.id ?? ""} onChange={(e) => run({ path: "", method: "PATCH", json: { assigneeId: e.target.value || null } })}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Due date">
            <Input type="date" value={dateInput(d.dueAt)} onChange={(e) => e.target.value && run({ path: "", method: "PATCH", json: { dueAt: new Date(`${e.target.value}T09:00:00`).toISOString() } })} />
          </Labeled>
        </div>
      )}
      {!canManage && d.assignee && <p className="text-xs text-muted-foreground">Owner: {d.assignee.name}</p>}

      <section className="space-y-2 border-t pt-3">
        <h4 className="text-sm font-semibold">Approval and publishing</h4>
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <Button size="sm" disabled={busy} onClick={() => run({ path: "/action", method: "POST", json: { action: "submit" } }, "Submitted for approval")}>
              Submit for approval
            </Button>
          )}
          {["planned", "drafting", "changes_requested"].includes(d.status) && d.canGenerate && !d.generationId && (
            <span className="text-xs text-muted-foreground">Generate or attach content before submitting.</span>
          )}
          {canManage && d.status === "awaiting_approval" && (
            <>
              <Button size="sm" disabled={busy} onClick={() => run({ path: "/action", method: "POST", json: { action: "approve" } }, "Approved")}>
                Approve
              </Button>
              <Input className="h-8 w-56" placeholder="Note (needed to reject or request changes)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => run({ path: "/action", method: "POST", json: { action: "request_changes", note } })}>
                Request changes
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => run({ path: "/action", method: "POST", json: { action: "reject", note } })}>
                Reject
              </Button>
            </>
          )}
          {!canManage && d.status === "awaiting_approval" && <span className="text-xs text-muted-foreground">Waiting for the business owner to approve.</span>}
          {canManage && ["approved", "completed", "cancelled", "changes_requested"].includes(d.status) && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ path: "/action", method: "POST", json: { action: "reopen" } })}>
              Reopen
            </Button>
          )}
        </div>

        {d.publishing.kind === "failed" && d.publishing.error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {d.publishing.error}
          </p>
        )}
        {d.publishing.kind === "published" && d.publishing.url && (
          <a href={d.publishing.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            View the live post <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {publishable && generation && (
          <>
            <Button size="sm" onClick={() => setShareOpen(true)}>
              {d.publishing.kind === "not_connected" || d.publishing.kind === "reauth_required" ? "Connect and publish" : "Publish or schedule"}
            </Button>
            <SocialShareDialog generation={generation} open={shareOpen} onOpenChange={setShareOpen} onScheduled={() => setShareOpen(false)} />
          </>
        )}
        {d.manualSteps.length > 0 && (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">
              {d.publishing.kind === "manual" ? "This needs to be done by hand" : "What to do next"}
              {d.publishing.kind === "manual" ? `: ${d.publishing.reason}` : ""}
            </p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
              {d.manualSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}
        {d.status === "approved" && d.publishing.kind !== "published" && d.publishing.kind !== "scheduled" && (
          <div className="space-y-2">
            {!manual ? (
              <Button size="sm" variant="outline" onClick={() => setManual({ note: "", url: "" })}>
                Mark as done (done outside the platform)
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border p-3">
                <Labeled label="What was done, where and when?" hint="This is recorded as your statement. The platform does not verify it.">
                  <Textarea rows={2} value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} />
                </Labeled>
                <Labeled label="Link (optional)">
                  <Input value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} placeholder="https://" />
                </Labeled>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || manual.note.trim().length < 3}
                    onClick={() =>
                      run({ path: "/manual-complete", method: "POST", json: { note: manual.note.trim(), ...(manual.url.trim() ? { externalUrl: manual.url.trim() } : {}) } }, "Recorded as done")
                    }
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setManual(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {d.status === "completed" && (
          <p className="text-sm text-muted-foreground">
            Marked done by a person: {d.completionNote}{" "}
            {d.externalUrl && (
              <a href={d.externalUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                link
              </a>
            )}
          </p>
        )}
      </section>

      {!closed && <FlagBox flagged={d.flaggedForReview} onFlag={(flagged, reason) => run({ path: "/flag", method: "POST", json: { flagged, reason } })} />}

      <History events={d.events} pending={mut.isPending} onComment={(n) => run({ path: "/comments", method: "POST", json: { note: n } })} />
    </div>
  );
}

/* ----------------------------------- task ---------------------------------- */

export function TaskDialog({ id, members, canManage, onClose }: { id: string; members: PersonDto[]; canManage: boolean; onClose: () => void }) {
  const { data: t } = useTask(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">{!t ? <Skeleton className="h-48 w-full" /> : <TaskBody t={t} members={members} canManage={canManage} />}</DialogContent>
    </Dialog>
  );
}

function TaskBody({ t, members, canManage }: { t: ExecTaskDto; members: PersonDto[]; canManage: boolean }) {
  const mut = useTaskMutation(t.id);
  const [reason, setReason] = useState(t.blockedReason ?? "");
  const patch = (json: Record<string, unknown>, ok?: string) => mut.mutate({ path: "", method: "PATCH", json }, { onSuccess: () => ok && toast.success(ok), onError: errToast });

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="pr-6">{t.title}</DialogTitle>
        <DialogDescription>
          <Link href={`/bcamp?strategy=${t.strategyId}`} className="text-primary hover:underline">
            {t.strategyTitle}
          </Link>
          {t.deliverableTitle ? ` · for ${t.deliverableTitle}` : ""}
        </DialogDescription>
      </DialogHeader>

      {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
      {t.blockedByDependency && t.dependsOn && (
        <p className="rounded-md border p-2 text-sm">
          Waiting on <span className="font-medium">{t.dependsOn.title}</span> ({t.dependsOn.status.replace(/_/g, " ")}). This can be started once that is done.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="Status">
          <Select value={t.status} onChange={(e) => patch({ status: e.target.value, ...(e.target.value === "blocked" ? { blockedReason: reason || undefined } : {}) })}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="Owner">
          <Select value={t.assignee?.id ?? ""} disabled={!canManage} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="Due date">
          <Input type="date" disabled={!canManage} value={dateInput(t.dueAt)} onChange={(e) => e.target.value && patch({ dueAt: new Date(`${e.target.value}T09:00:00`).toISOString() })} />
        </Labeled>
        <Labeled label="Priority">
          <Select value={t.priority} disabled={!canManage} onChange={(e) => patch({ priority: e.target.value })}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Labeled>
      </div>

      {(t.status === "blocked" || reason) && (
        <Labeled label="What is blocking this?">
          <div className="flex gap-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!reason.trim() || reason === t.blockedReason} onClick={() => patch({ blockedReason: reason.trim(), ...(t.status !== "blocked" ? { status: "blocked" } : {}) })}>
              Save
            </Button>
          </div>
        </Labeled>
      )}

      {t.checklist.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-semibold">Checklist</h4>
          {t.checklist.map((c, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.done} onChange={(e) => patch({ checklist: t.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
              <span className={c.done ? "line-through opacity-60" : ""}>{c.text}</span>
            </label>
          ))}
        </section>
      )}

      <FlagBox flagged={t.flaggedForReview} onFlag={(flagged, r) => mut.mutate({ path: "/flag", method: "POST", json: { flagged, reason: r } }, { onError: errToast })} />
      <History events={t.events} pending={mut.isPending} onComment={(n) => mut.mutate({ path: "/comments", method: "POST", json: { note: n } }, { onError: errToast })} />
    </div>
  );
}
