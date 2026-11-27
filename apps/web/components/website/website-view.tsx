"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Globe, Phone } from "lucide-react";
import { WEBSITE_DAYS, type WebsiteCountDto, type WebsiteLeadDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useExportWebsiteLeads, useWebsiteConsents, useWebsiteLeads, useWebsiteOverview } from "@/lib/website-hooks";

/* Website to CatGPT integration: the company website's leads, button taps, visitor sources
   and pop-up phone numbers, read live from the website's own database. Read-only. */

const CLICK_LABEL: Record<string, string> = {
  call_click: "📞 Call button",
  whatsapp_click: "💬 WhatsApp",
  directions_click: "📍 Directions / Maps",
  form_submit: "📝 Form submitted",
  "3d_open": "🏠 3D walkthrough opened",
  brochure_click: "📄 Brochure",
  email_click: "✉️ Email",
  outbound_click: "↗️ Link to another site",
  link_click: "🔗 Page link",
  button_click: "🔘 Other button",
};
const FORM_LABEL: Record<string, string> = {
  contact_page: "Contact form",
  site_visit: "Site visit form",
  enquire_now: "Enquire Now",
  brochure_download: "Brochure download",
  consent_popup: "Welcome pop-up",
};
const formLabel = (f: string | null) => (f ? FORM_LABEL[f] ?? f.replace(/_/g, " ") : "Website");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

type Tab = "overview" | "leads" | "numbers";

export function WebsiteView() {
  const [tab, setTab] = useState<Tab>("overview");
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
            <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">Website to CatGPT integration</h1>
            <p className="truncate text-xs text-muted-foreground">Leads, button taps and visitor sources from vgrandgroup.com</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-4 sm:py-6">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Website data">
              {([
                ["overview", "Overview"],
                ["leads", "Leads"],
                ["numbers", "Pop-up numbers"],
              ] as const).map(([id, label]) => (
                <Button key={id} size="sm" role="tab" aria-selected={tab === id} variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)}>
                  {label}
                </Button>
              ))}
            </div>
            {tab === "overview" && <Overview />}
            {tab === "leads" && <Leads />}
            {tab === "numbers" && <Numbers />}
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

/** Not connected / not allowed / failed: says what to do instead of a raw error. */
function Problem({ error }: { error: unknown }) {
  const e = error instanceof ApiRequestError ? error : null;
  if (e?.code === "WEBSITE_NOT_CONFIGURED") {
    return (
      <Card className="space-y-3 p-5 text-sm">
        <h2 className="flex items-center gap-2 font-semibold"><Globe className="size-4" /> Connect the website</h2>
        <p className="text-muted-foreground">This page reads the website&apos;s own database (read-only). An admin sets three values on the CatGPT API server once:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li><code>WEBSITE_SUPABASE_URL</code>: the website&apos;s Supabase project URL (Project Settings → API)</li>
          <li><code>WEBSITE_SUPABASE_SERVICE_KEY</code>: that project&apos;s service-role key</li>
          <li><code>WEBSITE_VIEWER_EMAILS</code>: CatGPT login emails allowed to see this page, separated by commas</li>
        </ol>
        <p className="text-muted-foreground">Then restart the API.</p>
      </Card>
    );
  }
  if (e?.status === 403) return <Card className="p-5 text-sm">{e.message}</Card>;
  return <Card className="p-5 text-sm text-destructive">{e?.message ?? "Could not load the website data."}</Card>;
}

function Bars({ title, rows, label = (n: string) => n, empty }: { title: string; rows: WebsiteCountDto[]; label?: (n: string) => string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
      <ul className="space-y-2.5">
        {rows.slice(0, 10).map((r) => (
          <li key={r.name} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="truncate">{label(r.name)}</span>
              <span className="font-semibold tabular-nums">{r.total.toLocaleString()}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(r.total / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Overview() {
  const [days, setDays] = useState<number>(30);
  const q = useWebsiteOverview(days);
  if (q.isError) return <Problem error={q.error} />;
  const d = q.data;
  const taps = d?.clicks.reduce((n, c) => n + c.total, 0) ?? 0;
  const calls = d?.clicks.find((c) => c.name === "call_click")?.total ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {WEBSITE_DAYS.map((n) => (
          <Button key={n} size="sm" variant={days === n ? "default" : "outline"} aria-pressed={days === n} onClick={() => setDays(n)}>Last {n} days</Button>
        ))}
      </div>
      {!d ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Form leads", d.leads],
              ["Pop-up numbers", d.consentNumbers],
              ["Call taps", calls],
              ["All button taps", taps],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{Number(value).toLocaleString()}</p>
              </Card>
            ))}
          </div>
          {!d.clicksReady && (
            <Card className="p-4 text-sm text-muted-foreground">
              Button taps and visitor sources appear once the website&apos;s lead-tracking update is live and <code>supabase_lead_tracking.sql</code> has been run on the website&apos;s database.
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <Bars title="What visitors tapped" rows={d.clicks} label={(n) => CLICK_LABEL[n] ?? n} empty="No taps in this period." />
            <Bars title="Where visitors came from" rows={d.visitorSources} empty="No visits recorded in this period." />
            <Bars title="Where leads came from" rows={d.leadSources} empty="No lead sources recorded yet." />
          </div>
        </>
      )}
    </div>
  );
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t p-2 text-xs">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      Page {page} of {pages}
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

function Leads() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const leads = useWebsiteLeads(page, q);
  const exporter = useExportWebsiteLeads();
  if (leads.isError && !leads.data) return <Problem error={leads.error} />;
  const d = leads.data;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Input className="max-w-sm flex-1" placeholder="Search name, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <span className="text-xs text-muted-foreground">{d ? `${d.total.toLocaleString()} leads` : ""}</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={exporter.isPending}
          onClick={() => exporter.mutate(q, { onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Export failed") })}
        >
          <Download className="size-4" /> Export CSV
        </Button>
      </div>
      {!d ? (
        <Skeleton className="m-3 h-40" />
      ) : d.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{q ? "No leads match this search." : "No website leads yet."}</p>
      ) : (
        <ul>{d.items.map((l) => <LeadRow key={l.id} lead={l} />)}</ul>
      )}
      {d && <Pager page={page} total={d.total} size={d.pageSize} onPage={setPage} />}
    </Card>
  );
}

function LeadRow({ lead: l }: { lead: WebsiteLeadDto }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b last:border-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left hover:bg-muted/50">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name || "No name"}</span>
        <span className="text-sm tabular-nums">{l.phone ?? ""}</span>
        <span className="w-full truncate text-xs text-muted-foreground sm:w-auto">
          {[formLabel(l.form), l.project, l.source && `from ${l.source}`].filter(Boolean).join(" · ")}
        </span>
        <span className="text-xs text-muted-foreground">{when(l.createdAt)}</span>
      </button>
      {open && (
        <div className="space-y-1.5 bg-muted/30 px-3 py-2.5 text-sm">
          {l.message && <p className="whitespace-pre-wrap">“{l.message}”</p>}
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {[
              ["Email", l.email],
              ["Form", formLabel(l.form)],
              ["Project", l.project],
              ["Came from", l.source],
              ["Campaign", l.campaign],
              ["Landing page", l.landingPage],
              ["Status", l.status],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></div>
            ))}
          </dl>
          {l.phone && (
            <Button size="sm" variant="outline" asChild>
              <a href={telHref(l.phone)}><Phone className="size-4" /> Call {l.phone}</a>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Numbers() {
  const [page, setPage] = useState(1);
  const q = useWebsiteConsents(page);
  if (q.isError && !q.data) return <Problem error={q.error} />;
  const d = q.data;
  return (
    <Card className="overflow-hidden">
      <p className="border-b p-3 text-xs text-muted-foreground">
        People who ticked &ldquo;I agree to be contacted&rdquo; in the website&apos;s welcome pop-up and typed their mobile number.
      </p>
      {!d ? (
        <Skeleton className="m-3 h-40" />
      ) : d.notice ? (
        <p className="p-4 text-sm text-muted-foreground">{d.notice}</p>
      ) : d.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No numbers shared yet.</p>
      ) : (
        <ul>
          {d.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-3 py-2.5 last:border-0">
              <a href={telHref(c.phone)} className={cn("text-sm font-medium tabular-nums underline-offset-2 hover:underline")}>{c.phone}</a>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{[c.source && `from ${c.source}`, c.page].filter(Boolean).join(" · ")}</span>
              <span className="text-xs text-muted-foreground">{when(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {d && <Pager page={page} total={d.total} size={d.pageSize} onPage={setPage} />}
    </Card>
  );
}
