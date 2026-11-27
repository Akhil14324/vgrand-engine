"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Instagram, Plus, Upload } from "lucide-react";
import { CRM_SOURCES, CRM_STAGES, followUpDue, type CrmLeadDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { localDay, useCrmLeads, useExportLeads, type CrmFilters } from "@/lib/crm-hooks";
import { useBrands } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { LeadDetail } from "./lead-detail";
import { AddLeadCard, ImportLeadsCard, InstagramCard } from "./lead-forms";
import { SOURCE_LABEL, STAGE_LABEL, dayLabel, errText, leadName } from "./labels";

const NO_FILTERS: CrmFilters = { stage: "", source: "", owner: "", q: "", due: "", page: 1 };
const PAGE_SIZE = 100;

export function CrmView() {
  return (
    <RequireAuth>
      <div className="app-safe-screen flex flex-col">
        <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/" aria-label="Back to studio">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">CRM</h1>
            <p className="truncate text-xs text-muted-foreground">Every lead, who owns it, and when to follow up</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-3 px-3 py-4 sm:px-4 sm:py-6">
            <Body />
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

function Body() {
  const brands = useBrands();
  const [pick, setPick] = useState<string | null>(null);
  if (brands.isLoading) return <Skeleton className="h-40 w-full" />;
  if (brands.isError) return <Card className="p-4 text-sm">{errText(brands.error, "Could not load your brands")}</Card>;
  const list = brands.data ?? [];
  const brand = list.find((b) => b.id === pick) ?? list[0];
  if (!brand) return <Card className="p-6 text-sm">Leads belong to a brand. <Link className="underline" href="/brand">Create a brand</Link> first.</Card>;
  return (
    <>
      <Select className="w-auto min-w-56" value={brand.id} onChange={(e) => setPick(e.target.value)} aria-label="Brand">
        {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      {/* Keyed so filters and the open lead reset when the brand changes. */}
      <Leads key={brand.id} brandId={brand.id} brandName={brand.name} />
    </>
  );
}

function Leads({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [f, setF] = useState(NO_FILTERS);
  const [sel, setSel] = useState<string | null>(null);
  const [panel, setPanel] = useState<"add" | "import" | "instagram" | null>(null);
  const leads = useCrmLeads(brandId, f);
  const exporter = useExportLeads();
  const set = (p: Partial<CrmFilters>) => setF({ ...f, page: 1, ...p });
  const data = leads.data;

  if (leads.isError && !data) return <Card className="p-4 text-sm">{errText(leads.error, "Could not load leads")}</Card>;
  if (!data) return <Skeleton className="h-60 w-full" />;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const chip = (label: string, count: number, due: string, warn = false) => (
    <Button size="sm" variant={f.due === due ? "default" : "outline"} aria-pressed={f.due === due} onClick={() => set({ due: f.due === due ? "" : due })}>
      {label} <span className={cn(warn && count > 0 && f.due !== due && "text-destructive")}>{count}</span>
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={!f.due && !f.stage ? "default" : "outline"} onClick={() => setF(NO_FILTERS)}>All leads {data.counts.all}</Button>
        {chip("Overdue", data.counts.overdue, "overdue", true)}
        {chip("Today", data.counts.today, "today")}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPanel(panel === "add" ? null : "add")}><Plus className="size-4" /> Add lead</Button>
          {data.canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setPanel(panel === "import" ? null : "import")}><Upload className="size-4" /> Import</Button>
              <Button size="sm" variant="outline" disabled={exporter.isPending} onClick={() => exporter.mutate(brandId, { onError: (e) => toast.error(errText(e, "Export failed")) })}>
                <Download className="size-4" /> Export
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPanel(panel === "instagram" ? null : "instagram")}><Instagram className="size-4" /> Instagram</Button>
            </>
          )}
        </div>
      </div>

      {panel === "add" && <AddLeadCard brandId={brandId} members={data.members} onClose={() => setPanel(null)} onAdded={(id) => { setPanel(null); setSel(id); }} />}
      {panel === "import" && <ImportLeadsCard brandId={brandId} onClose={() => setPanel(null)} />}
      {panel === "instagram" && <InstagramCard brandId={brandId} brandName={brandName} onClose={() => setPanel(null)} />}

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <Card className={cn("flex max-h-[75vh] flex-col overflow-hidden", sel && "hidden lg:flex")}>
          <div className="space-y-2 border-b p-2">
            <Input placeholder="Search name, number or @username" value={f.q} onChange={(e) => set({ q: e.target.value })} />
            <div className="flex gap-2">
              <Select value={f.stage} onChange={(e) => set({ stage: e.target.value })} aria-label="Stage">
                <option value="">All stages</option>
                {CRM_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]} ({data.counts.byStage[s] ?? 0})</option>)}
              </Select>
              <Select value={f.source} onChange={(e) => set({ source: e.target.value })} aria-label="Source">
                <option value="">All sources</option>
                {CRM_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </Select>
            </div>
            <Select value={f.owner} onChange={(e) => set({ owner: e.target.value })} aria-label="Owner">
              <option value="">Any owner</option>
              <option value="none">Unassigned</option>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {data.items.map((l) => <Row key={l.id} lead={l} selected={sel === l.id} onSelect={() => setSel(l.id)} />)}
            {!data.items.length && (
              <p className="p-4 text-sm text-muted-foreground">
                {data.counts.all ? "No leads match these filters." : "No leads yet. They appear when someone messages your WhatsApp number, or add and import them here."}
              </p>
            )}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t p-2 text-xs">
              <Button size="sm" variant="ghost" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</Button>
              Page {f.page} of {pages}
              <Button size="sm" variant="ghost" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</Button>
            </div>
          )}
        </Card>
        <div className={cn("min-w-0 space-y-2", !sel && "hidden lg:block")}>
          {sel ? (
            <>
              <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setSel(null)}><ArrowLeft className="size-4" /> All leads</Button>
              <LeadDetail key={sel} id={sel} members={data.members} canManage={data.canManage} onGone={() => setSel(null)} />
            </>
          ) : (
            <Card className="grid min-h-60 place-items-center p-6 text-sm text-muted-foreground">Select a lead</Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ lead, selected, onSelect }: { lead: CrmLeadDto; selected: boolean; onSelect: () => void }) {
  const closed = lead.stage === "won" || lead.stage === "lost";
  const due = closed ? "none" : followUpDue(lead.followUpOn, localDay());
  return (
    <button onClick={onSelect} className={cn("flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-muted/50", selected && "bg-muted")}>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{leadName(lead)}</span>
        {due !== "none" && (
          <span className={cn("text-[11px] font-semibold", due === "overdue" ? "text-destructive" : due === "today" ? "text-lavd" : "text-muted-foreground")}>
            {due === "overdue" ? `Overdue ${dayLabel(lead.followUpOn!)}` : due === "today" ? "Today" : dayLabel(lead.followUpOn!)}
          </span>
        )}
      </span>
      <span className="truncate text-xs text-muted-foreground">{[lead.phone && `+${lead.phone}`, lead.fields.bhk && `${lead.fields.bhk} BHK`, lead.fields.budget].filter(Boolean).join(" · ") || "No details yet"}</span>
      <span className="truncate text-[11px] text-muted-foreground">{STAGE_LABEL[lead.stage]} · {SOURCE_LABEL[lead.source]} · {lead.ownerName ?? "Unassigned"}</span>
    </button>
  );
}
