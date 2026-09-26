"use client";

import { useState, type FormEvent } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { CONSENT_KINDS, type ConsentKind } from "@catgpt/types";
import {
  useAddConsent,
  useConsents,
  useDeleteWorkspaceContent,
  useExportWorkspace,
  useRevokeConsent,
  useSetRetention,
  useWorkspacePrivacy,
} from "@/lib/workspace-privacy-hooks";
import { saveBlob } from "@/lib/image-tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";

const RETENTION_PRESETS = [30, 90, 180, 365];
const KIND_LABEL: Record<ConsentKind, string> = {
  ugc_repost: "Repost of their content",
  testimonial: "Use as a testimonial",
  dm_contact: "Contact by message",
  other: "Other",
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** Workspace "Privacy & data" tab: retention, export, delete generated content, consent log. */
export function WorkspacePrivacy({ workspaceId, name, isOwner }: { workspaceId: string; name: string; isOwner: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {isOwner ? (
        <>
          <RetentionCard workspaceId={workspaceId} />
          <ExportAndDeleteCard workspaceId={workspaceId} name={name} />
        </>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Only the workspace owner can change retention, export or delete workspace data. You can still use the consent log below.
        </p>
      )}
      <ConsentLog workspaceId={workspaceId} />
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function RetentionCard({ workspaceId }: { workspaceId: string }) {
  const { data } = useWorkspacePrivacy(workspaceId);
  const set = useSetRetention(workspaceId);
  const current = data?.retentionDays ?? null;
  const options = current && !RETENTION_PRESETS.includes(current) ? [...RETENTION_PRESETS, current].sort((a, b) => a - b) : RETENTION_PRESETS;

  return (
    <Card
      title="Automatic image deletion"
      hint="Delete generated images after a set time. Images used in a post or campaign are always kept, and chat text is never deleted."
    >
      <div className="flex items-center gap-2">
        <Select
          aria-label="Delete generated images after"
          className="max-w-[240px]"
          disabled={!data || set.isPending}
          value={current === null ? "" : String(current)}
          onChange={(e) => {
            const days = e.target.value ? Number(e.target.value) : null;
            if (days !== null && !window.confirm(`Images older than ${days} days will be deleted permanently, starting within a few hours. Continue?`)) return;
            set.mutate(days, {
              onSuccess: () => toast.success(days ? `Images will be deleted after ${days} days` : "Automatic deletion is off"),
              onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't save"),
            });
          }}
        >
          <option value="">Keep forever</option>
          {options.map((d) => (
            <option key={d} value={d}>
              After {d} days
            </option>
          ))}
        </Select>
        {set.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </Card>
  );
}

function ExportAndDeleteCard({ workspaceId, name }: { workspaceId: string; name: string }) {
  const exportData = useExportWorkspace(workspaceId);
  const del = useDeleteWorkspaceContent(workspaceId);
  const [confirm, setConfirm] = useState("");

  return (
    <Card
      title="Export and delete"
      hint="Export downloads your workspace data as one JSON file (media as links; no social tokens). Delete removes every chat and generated image."
    >
      <div>
        <Button
          variant="outline"
          onClick={() =>
            exportData.mutate(undefined, {
              onSuccess: (blob) => saveBlob(blob, `${name.replace(/[^\w-]+/g, "-")}-export.json`),
              onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
            })
          }
          disabled={exportData.isPending}
        >
          {exportData.isPending ? <Loader2 className="animate-spin" /> : <Download />}
          Export workspace data
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
        <p className="text-sm font-medium text-destructive">Delete all chats and generated images</p>
        <p className="text-xs text-muted-foreground">
          This cannot be undone. Brands, brand files, guidelines, documents, team chat and the consent log are kept. Posts already
          published stay on the platforms; posts still scheduled from these images are removed.
        </p>
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={`Type "${name}" to confirm`}
          aria-label="Type the workspace name to confirm"
        />
        <div>
          <Button
            variant="destructive"
            disabled={confirm.trim() !== name.trim() || del.isPending}
            onClick={() =>
              del.mutate(confirm, {
                onSuccess: (r) => {
                  setConfirm("");
                  toast.success(`Deleted ${r.conversationsDeleted} chats and ${r.imagesDeleted} images`);
                },
                onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
              })
            }
          >
            {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete generated content
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ConsentLog({ workspaceId }: { workspaceId: string }) {
  const { data: consents, isLoading } = useConsents(workspaceId);
  const add = useAddConsent(workspaceId);
  const revoke = useRevokeConsent(workspaceId);
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<ConsentKind>("ugc_repost");
  const [scope, setScope] = useState("");
  const [evidence, setEvidence] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { subject: subject.trim(), kind, scope: scope.trim() || undefined, evidenceUrl: evidence.trim() || undefined },
      {
        onSuccess: () => {
          setSubject("");
          setScope("");
          setEvidence("");
          toast.success("Consent recorded");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't save"),
      },
    );
  };

  return (
    <Card
      title="Consent log"
      hint="Record when someone agrees to be featured or contacted (for example to repost their photo). Records are never edited or deleted, only revoked, so the history stays trustworthy."
    >
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Who (handle, name or email)" aria-label="Who consented" required maxLength={200} />
        <Select value={kind} onChange={(e) => setKind(e.target.value as ConsentKind)} aria-label="What they agreed to">
          {CONSENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What exactly (e.g. the photo posted on 3 May)" aria-label="Scope" maxLength={1000} />
        <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Link to the message or screenshot (optional)" aria-label="Evidence link" type="url" />
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={!subject.trim() || add.isPending}>
            {add.isPending && <Loader2 className="animate-spin" />}
            Add record
          </Button>
        </div>
      </form>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : !consents?.length ? (
        <p className="text-sm text-muted-foreground">No consent records yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {consents.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.subject} <span className="font-normal text-muted-foreground">- {KIND_LABEL[c.kind]}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Given {fmt(c.grantedAt)}
                  {c.scope ? ` - ${c.scope}` : ""}
                  {c.evidenceUrl && (
                    <>
                      {" - "}
                      <a href={c.evidenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        evidence
                      </a>
                    </>
                  )}
                </p>
              </div>
              {c.revokedAt ? (
                <Badge variant="muted">Revoked {fmt(c.revokedAt)}</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (window.confirm(`Mark ${c.subject}'s consent as withdrawn?`)) {
                      revoke.mutate(c.id, { onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't revoke") });
                    }
                  }}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
