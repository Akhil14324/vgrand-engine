"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { CRM_FIELDS, CRM_STAGES, type CrmLeadDto, type CrmLeadUpdateInput, type CrmMemberDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useAddLeadNote, useCrmLead, useCrmLeads, useDeleteLead, useMergeLead, useUpdateLead } from "@/lib/crm-hooks";
import { cn } from "@/lib/utils";
import { FIELD_LABEL, SOURCE_LABEL, STAGE_LABEL, errText, leadName, when } from "./labels";

export function LeadDetail({ id, members, canManage, onGone }: { id: string; members: CrmMemberDto[]; canManage: boolean; onGone: () => void }) {
  const detail = useCrmLead(id);
  const update = useUpdateLead(id);
  const remove = useDeleteLead();
  if (detail.isError) return <Card className="p-6 text-sm text-muted-foreground">{errText(detail.error, "Could not load this lead")}</Card>;
  if (!detail.data) return <Card className="grid min-h-60 place-items-center p-6 text-sm text-muted-foreground">Loading…</Card>;
  const { lead, activities, messages } = detail.data;
  const save = (patch: CrmLeadUpdateInput) => update.mutate(patch, { onError: (e) => toast.error(errText(e, "Could not save")) });

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-base font-semibold">{leadName(lead)}</h2>
            <p className="text-xs text-muted-foreground">
              {lead.phone ? <a className="underline" href={`tel:+${lead.phone}`}>+{lead.phone}</a> : "No phone number yet"}
              {lead.instagram && <> · <a className="underline" href={`https://instagram.com/${lead.instagram}`} target="_blank" rel="noreferrer">@{lead.instagram}</a></>}
            </p>
          </div>
          <Badge variant="muted">{SOURCE_LABEL[lead.source]}</Badge>
          {lead.phone && (
            <Button size="sm" variant="outline" asChild>
              <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs font-medium">
            Stage
            <Select value={lead.stage} onChange={(e) => save({ stage: e.target.value as CrmLeadDto["stage"] })}>
              {CRM_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Owner
            <Select value={lead.ownerId ?? ""} onChange={(e) => save({ ownerId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {lead.ownerId && !members.some((m) => m.id === lead.ownerId) && <option value={lead.ownerId}>{lead.ownerName}</option>}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </label>
          <FollowUp key={lead.followUpOn ?? "none"} value={lead.followUpOn} onSave={(followUpOn) => save({ followUpOn })} />
        </div>
      </Card>

      <DetailsForm lead={lead} />
      <Notes id={id} />

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">History</h3>
        {activities.map((a) => (
          <div key={a.id} className="border-b pb-1.5 text-sm last:border-0">
            <p className="whitespace-pre-wrap break-words">{a.kind === "call" ? "Call: " : ""}{a.text}</p>
            <p className="text-[11px] text-muted-foreground">{a.by ?? "Automatic"} · {when(a.createdAt)}</p>
          </div>
        ))}
        {!activities.length && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
      </Card>

      {messages.length > 0 && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">WhatsApp chat (latest {messages.length})</h3>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] whitespace-pre-wrap break-words rounded-lg border px-3 py-1.5 text-sm", m.direction === "out" && "bg-muted")}>
                  {m.text}
                  <div className="mt-0.5 text-right text-[10px] opacity-60">{when(m.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Reply from Brand Engine → WhatsApp → Inbox.</p>
        </Card>
      )}

      <Merge lead={lead} />

      {canManage && (
        <Button
          size="sm"
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(`Delete ${leadName(lead)} and its notes? A new message from them would create the lead again.`)) return;
            remove.mutate(lead.id, { onSuccess: onGone, onError: (e) => toast.error(errText(e, "Could not delete")) });
          }}
        >
          <Trash2 className="size-4" /> Delete lead
        </Button>
      )}
    </div>
  );
}

/** Saves on leaving the field: a date input reports half-typed years while being edited. */
function FollowUp({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <label className="space-y-1 text-xs font-medium">
      Next follow-up
      <Input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== (value ?? "")) onSave(draft || null);
        }}
      />
    </label>
  );
}

const formOf = (l: CrmLeadDto) => ({
  name: l.name ?? "",
  phone: l.phone ? `+${l.phone}` : "",
  ...(Object.fromEntries(CRM_FIELDS.map((k) => [k, l.fields[k] ?? ""])) as Record<(typeof CRM_FIELDS)[number], string>),
});

function DetailsForm({ lead }: { lead: CrmLeadDto }) {
  const update = useUpdateLead(lead.id);
  const latest = formOf(lead);
  const [base, setBase] = useState(latest);
  const [draft, setDraft] = useState(latest);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  // Take in changes made elsewhere (e.g. the bot learned a budget) unless someone is mid-edit.
  const stamp = JSON.stringify(latest);
  useEffect(() => {
    if (!dirty) {
      setBase(latest);
      setDraft(latest);
    }
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    // Send only what this person changed, so an untouched box never overwrites newer data.
    const patch: CrmLeadUpdateInput = {};
    if (draft.name !== base.name) patch.name = draft.name;
    if (draft.phone !== base.phone) patch.phone = draft.phone;
    const changed = CRM_FIELDS.filter((k) => draft[k] !== base[k]);
    if (changed.length) patch.fields = Object.fromEntries(changed.map((k) => [k, draft[k]]));
    update.mutate(patch, {
      onSuccess: (r) => {
        const next = formOf(r.lead);
        setBase(next);
        setDraft(next);
        toast.success("Saved");
      },
      onError: (e) => toast.error(errText(e, "Could not save")),
    });
  };

  const box = (key: keyof typeof draft, label: string) => (
    <label key={key} className="space-y-1 text-xs font-medium">
      {label}
      <Input value={draft[key]} maxLength={key === "phone" ? 30 : key === "name" ? 120 : 200} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <Card className="p-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) submit();
        }}
      >
        <h3 className="text-sm font-semibold">Details</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("name", "Name")}
          {box("phone", "Phone")}
          {CRM_FIELDS.map((k) => box(k, FIELD_LABEL[k]))}
        </div>
        <Button type="submit" size="sm" disabled={!dirty || update.isPending}>{update.isPending ? "Saving…" : "Save details"}</Button>
      </form>
    </Card>
  );
}

function Notes({ id }: { id: string }) {
  const add = useAddLeadNote(id);
  const [kind, setKind] = useState<"note" | "call">("note");
  const [text, setText] = useState("");
  return (
    <Card className="p-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          add.mutate({ kind, text: text.trim() }, { onSuccess: () => setText(""), onError: (er) => toast.error(errText(er, "Could not add the note")) });
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Add a note</h3>
          <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value as "note" | "call")} aria-label="Note type">
            <option value="note">Note</option>
            <option value="call">Phone call</option>
          </Select>
        </div>
        <Textarea rows={2} maxLength={2000} placeholder="What was said, and what happens next" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="sm" disabled={add.isPending || !text.trim()}>Add</Button>
      </form>
    </Card>
  );
}

/** One person can arrive twice (Instagram has no phone number): fold the other record into this one. */
function Merge({ lead }: { lead: CrmLeadDto }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const merge = useMergeLead(lead.id);
  const found = useCrmLeads(open && q.trim().length >= 2 ? lead.brandId : null, { stage: "", source: "", owner: "", due: "", q: q.trim(), page: 1 });
  const matches = (found.data?.items ?? []).filter((l) => l.id !== lead.id).slice(0, 6);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Same person twice? Merge</Button>;
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold">Merge another lead into this one</h3>
      <p className="text-xs text-muted-foreground">Notes and details move here and the other record is removed. This can&apos;t be undone.</p>
      <Input placeholder="Search by name, number or Instagram username" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.map((o) => (
        <div key={o.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{leadName(o)} · {SOURCE_LABEL[o.source]}{o.phone ? ` · +${o.phone}` : ""}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={merge.isPending}
            onClick={() => {
              if (!window.confirm(`Merge ${leadName(o)} into ${leadName(lead)}? This can't be undone.`)) return;
              merge.mutate(o.id, { onSuccess: () => { setOpen(false); setQ(""); toast.success("Leads merged"); }, onError: (e) => toast.error(errText(e, "Could not merge")) });
            }}
          >
            Merge
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
    </Card>
  );
}
