"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { WA_KINDS, WA_STAGES, type WaBroadcastDto, type WaNumberDto, type WaTemplateDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useCancelWaBroadcast, useCreateWaBroadcast, useWaAudience, useWaBroadcasts, useWaTemplates } from "@/lib/whatsapp-hooks";

const errText = (e: unknown, fb: string) => (e instanceof ApiRequestError ? e.message : fb);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

export function BroadcastsTab({ number }: { number: WaNumberDto }) {
  const list = useWaBroadcasts(number.id);
  const cancel = useCancelWaBroadcast();
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">Sends an approved template to people who agreed to messages. Anyone who replied STOP is skipped automatically.</p>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> New broadcast</Button>
      </div>
      {creating && <BroadcastForm number={number} onClose={() => setCreating(false)} />}
      {list.data?.length === 0 && !creating && <Card className="p-4 text-sm text-muted-foreground">No broadcasts yet.</Card>}
      {list.data?.map((b) => <BroadcastCard key={b.id} b={b} onCancel={() => window.confirm("Stop this broadcast? Messages already sent stay sent.") && cancel.mutate(b.id)} />)}
    </div>
  );
}

function BroadcastCard({ b, onCancel }: { b: WaBroadcastDto; onCancel: () => void }) {
  const c = b.counts;
  const pct = (n: number) => (c.total ? Math.round((n / c.total) * 100) : 0);
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{b.name}</b>
        <Badge variant={b.status === "done" ? "secondary" : b.status === "cancelled" ? "destructive" : "muted"}>{b.status}</Badge>
        <span className="text-xs text-muted-foreground">{b.templateName}{b.scheduledAt && b.status === "draft" ? ` · scheduled ${when(b.scheduledAt)}` : ""}</span>
        {(b.status === "sending" || b.status === "draft") && <Button size="sm" variant="outline" className="ml-auto" onClick={onCancel}>Stop</Button>}
      </div>
      {c.total > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <Stat label="People" v={String(c.total)} />
          <Stat label="Sent" v={`${c.sent} (${pct(c.sent)}%)`} />
          <Stat label="Delivered" v={`${c.delivered} (${pct(c.delivered)}%)`} />
          <Stat label="Read" v={`${c.read} (${pct(c.read)}%)`} />
          <Stat label="Failed" v={String(c.failed)} bad={c.failed > 0} />
        </div>
      )}
    </Card>
  );
}
const Stat = ({ label, v, bad }: { label: string; v: string; bad?: boolean }) => (
  <div className="rounded border px-2 py-1"><div className="text-muted-foreground">{label}</div><div className={bad ? "font-semibold text-destructive" : "font-semibold"}>{v}</div></div>
);

function BroadcastForm({ number, onClose }: { number: WaNumberDto; onClose: () => void }) {
  const templates = useWaTemplates(number.id);
  const approved = (templates.data ?? []).filter((t) => t.metaStatus === "approved");
  const create = useCreateWaBroadcast(number.id);
  const [name, setName] = useState("");
  const [tid, setTid] = useState("");
  const [kind, setKind] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [map, setMap] = useState<string[]>([]);
  const [at, setAt] = useState("");
  const t: WaTemplateDto | undefined = approved.find((x) => x.id === tid) ?? approved[0];
  const audience = {
    ...(kind ? { kind: kind as "lead" | "buyer" } : {}),
    ...(stages.length ? { stages: stages as (typeof WA_STAGES)[number][] } : {}),
    ...(tags.trim() ? { tags: tags.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
  };
  const aud = useWaAudience(number.id, audience);
  const specs = t ? t.variables.map((_, i) => map[i] ?? (i === 0 ? "name" : "")) : [];
  const ready = !!t && !!name.trim() && specs.every(Boolean) && (aud.data?.eligible ?? 0) > 0;

  return (
    <Card className="space-y-3 p-4">
      {approved.length === 0 ? (
        <p className="text-sm text-muted-foreground">You need an approved template first. Create one in the Templates tab and press &quot;Check approval&quot;.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input className="w-64" placeholder="Broadcast name (for you)" value={name} onChange={(e) => setName(e.target.value)} />
            <Select className="w-auto min-w-56" value={t?.id ?? ""} onChange={(e) => { setTid(e.target.value); setMap([]); }} aria-label="Template">
              {approved.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </div>
          {t && <p className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">{t.body}</p>}
          {t?.variables.map((vn, i) => (
            <div key={i} className="flex items-center gap-2">
              <code className="w-24 truncate text-xs">{`{{${i + 1}}} ${vn}`}</code>
              <Input placeholder='"name", "field:budget", or "text:Diwali offer"' value={specs[i] ?? ""} onChange={(e) => setMap(Array.from({ length: t.variables.length }, (_, k) => (k === i ? e.target.value : (specs[k] ?? ""))))} />
            </div>
          ))}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold">Who gets it</h4>
            <div className="flex flex-wrap items-center gap-2">
              <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
                <option value="">Leads + buyers</option>
                {WA_KINDS.map((k) => <option key={k} value={k}>{k}s only</option>)}
              </Select>
              <Input className="w-56" placeholder="Tags (any of), comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {WA_STAGES.map((s) => (
                <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={stages.includes(s)} onChange={(e) => setStages(e.target.checked ? [...stages, s] : stages.filter((x) => x !== s))} />{s.replace("_", " ")}</label>
              ))}
            </div>
            <p className="text-sm">
              <b>{aud.data?.eligible ?? "…"}</b> people will receive this.
              {!!aud.data?.skippedNoConsent && <span className="text-xs text-muted-foreground"> {aud.data.skippedNoConsent} more match but haven&apos;t agreed to messages, so they are skipped.</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs">Schedule (optional)</label>
            <Input className="w-56" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              disabled={create.isPending || !ready}
              onClick={() => {
                if (!t) return;
                const scheduledAt = at ? new Date(at).toISOString() : null;
                if (!window.confirm(`${scheduledAt ? "Schedule" : "Send"} "${t.name}" to ${aud.data?.eligible} people${scheduledAt ? ` at ${new Date(at).toLocaleString()}` : " now"}?`)) return;
                create.mutate(
                  { name: name.trim(), templateId: t.id, audience, variableMap: specs, scheduledAt, sendNow: !scheduledAt },
                  { onSuccess: () => { toast.success(scheduledAt ? "Scheduled" : "Sending started"); onClose(); }, onError: (e) => toast.error(errText(e, "Could not start the broadcast")) },
                );
              }}
            >
              {at ? "Schedule" : "Send now"}
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}
    </Card>
  );
}
