"use client";

import { useState } from "react";
import { CRM_FIELDS, CRM_MANUAL_SOURCES, CRM_MAX_IMPORT, CRM_STAGES, csvToImportRows, type CrmMemberDto, type CrmStage } from "@catgpt/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useCreateLead, useCrmInstagram, useImportLeads, useSetCrmInstagram } from "@/lib/crm-hooks";
import { FIELD_LABEL, SOURCE_LABEL, STAGE_LABEL, errText } from "./labels";

export function AddLeadCard({ brandId, members, onClose, onAdded }: { brandId: string; members: CrmMemberDto[]; onClose: () => void; onAdded: (id: string) => void }) {
  const create = useCreateLead();
  const empty = { name: "", phone: "", source: "call" as (typeof CRM_MANUAL_SOURCES)[number], stage: "new" as CrmStage, ownerId: "", followUpOn: "", note: "" };
  const [s, setS] = useState(empty);
  const [fields, setFields] = useState<Partial<Record<(typeof CRM_FIELDS)[number], string>>>({});
  return (
    <Card className="p-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { brandId, ...s, ownerId: s.ownerId || null, followUpOn: s.followUpOn || null, fields },
            { onSuccess: (r) => { toast.success("Lead added"); onAdded(r.id); }, onError: (er) => toast.error(errText(er, "Could not add the lead")) },
          );
        }}
      >
        <h3 className="text-sm font-semibold">Add a lead</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Input placeholder="Name" aria-label="Name" maxLength={120} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          <Input placeholder="Phone (10 digits get +91)" aria-label="Phone" inputMode="tel" maxLength={30} value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} />
          <Select value={s.source} onChange={(e) => setS({ ...s, source: e.target.value as typeof s.source })} aria-label="Source">
            {CRM_MANUAL_SOURCES.map((v) => <option key={v} value={v}>{SOURCE_LABEL[v]}</option>)}
          </Select>
          <Select value={s.stage} onChange={(e) => setS({ ...s, stage: e.target.value as CrmStage })} aria-label="Stage">
            {CRM_STAGES.map((v) => <option key={v} value={v}>{STAGE_LABEL[v]}</option>)}
          </Select>
          <Select value={s.ownerId} onChange={(e) => setS({ ...s, ownerId: e.target.value })} aria-label="Owner">
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-xs">
            Follow up on
            <Input type="date" value={s.followUpOn} onChange={(e) => setS({ ...s, followUpOn: e.target.value })} />
          </label>
          {CRM_FIELDS.map((k) => (
            <Input key={k} placeholder={FIELD_LABEL[k]} aria-label={FIELD_LABEL[k]} maxLength={200} value={fields[k] ?? ""} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
          ))}
        </div>
        <Textarea rows={2} maxLength={2000} placeholder="First note (optional)" value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} />
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending || (!s.name.trim() && !s.phone.trim())}>{create.isPending ? "Adding…" : "Add lead"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </form>
    </Card>
  );
}

export function ImportLeadsCard({ brandId, onClose }: { brandId: string; onClose: () => void }) {
  const imp = useImportLeads();
  const [raw, setRaw] = useState("");
  const rows = csvToImportRows(raw);
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold">Import leads from CSV</h3>
      <p className="text-xs text-muted-foreground">
        First row: column titles such as <code>name, phone, budget, bhk, location</code>. Without titles, each line is read as <code>phone, name</code>. Numbers already in the CRM only get their blank
        details filled. Importing does not subscribe anyone to WhatsApp broadcasts.
      </p>
      <Input
        type="file"
        accept=".csv,.txt,text/csv"
        aria-label="CSV file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void file.text().then(setRaw);
        }}
      />
      <Textarea rows={5} placeholder={"name,phone,budget\nRavi Kumar,9876543210,80 lakh"} value={raw} onChange={(e) => setRaw(e.target.value)} />
      {rows.length > CRM_MAX_IMPORT && <p className="text-xs text-destructive">At most {CRM_MAX_IMPORT} rows at a time. Split the file.</p>}
      <div className="flex gap-2">
        <Button
          disabled={imp.isPending || !rows.length || rows.length > CRM_MAX_IMPORT}
          onClick={() =>
            imp.mutate(
              { brandId, rows },
              {
                onSuccess: (r) => { toast.success(`${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged${r.invalid ? `, ${r.invalid} invalid numbers` : ""}`); setRaw(""); onClose(); },
                onError: (e) => toast.error(errText(e, "Import failed")),
              },
            )
          }
        >
          {imp.isPending ? "Importing…" : `Import ${rows.length || ""}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Card>
  );
}

export function InstagramCard({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const accounts = useCrmInstagram(brandId);
  const set = useSetCrmInstagram();
  const choose = (accountId: string, to: string | null) =>
    set.mutate(
      { accountId, brandId: to },
      {
        onSuccess: (r) => toast.success(to ? `Connected. ${r.added} people added from past activity.` : "Stopped adding leads from this account"),
        onError: (e) => toast.error(errText(e, "Could not change this account")),
      },
    );
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold">Instagram leads</h3>
      <p className="text-xs text-muted-foreground">
        Anyone whose comment or DM matches an IG Automations rule becomes a lead of the brand you pick. Instagram gives a username, not a phone number.
      </p>
      {accounts.isError && <p className="text-xs text-destructive">{errText(accounts.error, "Could not load accounts")}</p>}
      {accounts.data?.length === 0 && <p className="text-sm text-muted-foreground">No Instagram account is connected. Connect one under IG Automations first.</p>}
      {accounts.data?.map((a) => (
        <div key={a.accountId} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            <b>{a.handle ? `@${a.handle.replace(/^@/, "")}` : "Instagram account"}</b>
            <span className="text-muted-foreground"> · {a.brandName ? `leads go to ${a.brandName}` : "not adding leads"}</span>
          </span>
          {a.brandId !== brandId && (
            <Button size="sm" variant="outline" disabled={set.isPending} onClick={() => choose(a.accountId, brandId)}>Send leads to {brandName}</Button>
          )}
          {a.brandName && <Button size="sm" variant="ghost" disabled={set.isPending} onClick={() => choose(a.accountId, null)}>Stop</Button>}
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
    </Card>
  );
}
