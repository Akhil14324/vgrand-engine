"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, CheckCheck, Upload, UserRound } from "lucide-react";
import { WA_KINDS, WA_STAGES, type WaContactDto, type WaMessageDto, type WaNumberDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useImportWaContacts, usePatchWaContact, useSendWaMessage, useWaContacts, useWaThread } from "@/lib/whatsapp-hooks";

const errText = (e: unknown, fb: string) => (e instanceof ApiRequestError ? e.message : fb);
const label = (c: WaContactDto) => c.name || `+${c.waId}`;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const pretty = (s: string) => s.replace("_", " ");

export function InboxTab({ number }: { number: WaNumberDto }) {
  const [f, setF] = useState({ stage: "", kind: "", q: "", unread: false });
  const [sel, setSel] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const contacts = useWaContacts(number.id, f);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Card className="flex max-h-[70vh] flex-col overflow-hidden">
          <div className="space-y-2 border-b p-2">
            <Input placeholder="Search name or number" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <div className="flex gap-2">
              <Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} aria-label="Stage">
                <option value="">All stages</option>
                {WA_STAGES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
              </Select>
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Type">
                <option value="">Leads + buyers</option>
                {WA_KINDS.map((k) => <option key={k} value={k}>{k}s</option>)}
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.unread} onChange={(e) => setF({ ...f, unread: e.target.checked })} /> Unread only</label>
              <Button size="sm" variant="outline" onClick={() => setImporting((v) => !v)}><Upload className="size-3.5" /> Import</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {contacts.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No chats yet. They appear when someone messages this number, or import your buyers.</p>}
            {contacts.data?.map((c) => (
              <button key={c.id} onClick={() => setSel(c.id)} className={cn("flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-muted/50", sel === c.id && "bg-muted")}>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{label(c)}</span>
                  {c.unreadCount > 0 && <Badge>{c.unreadCount}</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground">{c.lastMessage ?? "—"}</span>
                <span className="flex gap-1 text-[11px] text-muted-foreground">
                  <span>{pretty(c.stage)}</span>·<span>{c.kind}</span>{c.botPaused && <>·<span>human</span></>}
                </span>
              </button>
            ))}
          </div>
        </Card>
        {sel ? <Thread key={sel} contactId={sel} /> : <Card className="grid min-h-60 place-items-center p-6 text-sm text-muted-foreground">Select a chat</Card>}
      </div>
      {importing && <ImportCard number={number} onClose={() => setImporting(false)} />}
    </div>
  );
}

function Tick({ m }: { m: WaMessageDto }) {
  if (m.direction === "in") return null;
  if (m.status === "failed") return <span className="text-destructive">failed</span>;
  if (m.status === "read") return <CheckCheck className="size-3.5 text-sky-500" />;
  if (m.status === "delivered") return <CheckCheck className="size-3.5" />;
  return <Check className="size-3.5" />;
}

function Thread({ contactId }: { contactId: string }) {
  const thread = useWaThread(contactId);
  const patch = usePatchWaContact();
  const send = useSendWaMessage();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const c = thread.data?.contact;
  const count = thread.data?.items.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [count]);
  if (!c) return <Card className="grid min-h-60 place-items-center p-6 text-sm text-muted-foreground">Loading…</Card>;
  const set = (p: Record<string, unknown>) => patch.mutate({ id: c.id, patch: p }, { onError: (e) => toast.error(errText(e, "Could not update")) });
  const fields = Object.entries(c.fields);
  return (
    <Card className="flex max-h-[70vh] min-h-[50vh] flex-col overflow-hidden">
      <div className="space-y-2 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{label(c)}</div>
            <div className="text-xs text-muted-foreground">+{c.waId}</div>
          </div>
          <Select className="w-auto" value={c.stage} onChange={(e) => set({ stage: e.target.value })} aria-label="Stage">
            {WA_STAGES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
          </Select>
          <Select className="w-auto" value={c.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Type">
            {WA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
          <Button size="sm" variant={c.botPaused ? "default" : "outline"} onClick={() => set({ botPaused: !c.botPaused })}>
            {c.botPaused ? <><Bot className="size-3.5" /> Resume bot</> : <><UserRound className="size-3.5" /> Take over</>}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {fields.map(([k, v]) => <Badge key={k} variant="muted">{k}: {v}</Badge>)}
          {c.optedIn ? (
            <Badge variant="secondary">Subscribed</Badge>
          ) : (
            <button className="underline" onClick={() => window.confirm("Confirm this person agreed to receive WhatsApp marketing messages from you.") && set({ optedIn: true })}>
              {c.optedOutAt ? "Unsubscribed (STOP)" : "Not subscribed"} · mark as consented
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3">
        {thread.data?.items.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm", m.direction === "out" ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-50" : "bg-background border")}>
              {m.templateName && <div className="mb-0.5 text-[11px] font-semibold uppercase opacity-60">Template · {m.templateName}</div>}
              {m.mediaUrl && /\.(png|jpe?g|webp)(\?|$)/i.test(m.mediaUrl) && <img src={m.mediaUrl} alt="" className="mb-1 max-h-48 rounded" />}
              {m.text ?? `[${m.type}]`}
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-60">
                {m.direction === "out" && <span>{m.source}</span>}
                {time(m.createdAt)}<Tick m={m} />
              </div>
              {m.error && <div className="text-[11px] text-destructive">{m.error}</div>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="border-t p-2">
        {c.canReply ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              send.mutate({ id: c.id, text: text.trim() }, { onSuccess: () => setText(""), onError: (er) => toast.error(errText(er, "Could not send")) });
            }}
          >
            <Textarea rows={2} className="min-h-0 flex-1" placeholder="Reply as a person (pauses the bot for this chat)" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" disabled={send.isPending || !text.trim()}>Send</Button>
          </form>
        ) : (
          <p className="p-2 text-xs text-muted-foreground">WhatsApp only allows free replies within 24 hours of their last message. Send them an approved template from Broadcasts instead.</p>
        )}
      </div>
    </Card>
  );
}

function ImportCard({ number, onClose }: { number: WaNumberDto; onClose: () => void }) {
  const imp = useImportWaContacts(number.id);
  const [raw, setRaw] = useState("");
  const [kind, setKind] = useState("buyer");
  const [tags, setTags] = useState("");
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState(false);
  const rows = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [phone, ...name] = l.split(/[,\t]/);
    return { phone: (phone ?? "").trim(), name: name.join(" ").trim() || undefined };
  });
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold">Import contacts</h3>
      <p className="text-xs text-muted-foreground">One per line: <code>phone, name</code>. 10-digit numbers get +91. People who replied STOP are never re-added.</p>
      <Textarea rows={5} placeholder={"9876543210, Ravi Kumar\n+919812345678, Sita"} value={raw} onChange={(e) => setRaw(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="buyer">Existing buyers</option><option value="lead">Leads</option></Select>
        <Input className="w-56" placeholder="Tags, e.g. vgrand-heights, block-a" value={tags} onChange={(e) => setTags(e.target.value)} />
        <Input className="w-64" placeholder="Where consent came from (e.g. booking form)" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> These people agreed to receive WhatsApp messages from this brand. Sending marketing to people who did not can get the number banned.</label>
      <div className="flex gap-2">
        <Button
          disabled={imp.isPending || !consent || source.trim().length < 2 || !rows.length}
          onClick={() =>
            imp.mutate(
              { kind, consent: true, consentSource: source.trim(), tags: tags.split(",").map((t) => t.trim()).filter(Boolean), rows },
              { onSuccess: (r) => { toast.success(`${r.added} added, ${r.updated} updated${r.invalid ? `, ${r.invalid} invalid` : ""}`); setRaw(""); onClose(); }, onError: (e) => toast.error(errText(e, "Import failed")) },
            )
          }
        >
          Import {rows.length || ""}
        </Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Card>
  );
}
