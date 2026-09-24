"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  ImagePlus,
  Loader2,
  Megaphone,
  Plus,
  Store,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  computeBrandSnapshot,
  type BrandDto,
  type BrandProfile,
} from "@catgpt/types";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import {
  useAddBrandAsset,
  useBrandDocuments,
  useBrands,
  useCreateBrand,
  useDeleteBrand,
  useDeleteBrandAsset,
  useDeleteDocument,
  useUpdateBrand,
  useWorkspaces,
} from "@/lib/hooks";
import { useBrandMode } from "@/lib/brand-mode";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const CHANNELS = [
  "Instagram",
  "WhatsApp",
  "Facebook",
  "Google Ads",
  "YouTube",
  "Website / online store",
  "Marketplace (Amazon, Flipkart…)",
  "Walk-in / offline",
  "Word of mouth",
];
const STAGES = ["Just an idea", "Under 1 year", "1–3 years", "3+ years"];
const DOC_ACCEPT =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx";

export function BrandView() {
  const router = useRouter();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return null;
  return <BrandContent />;
}

function BrandContent() {
  const { data: brands, isLoading } = useBrands();
  const { data: workspaces } = useWorkspaces();
  const createBrand = useCreateBrand();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [personalName, setPersonalName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const personal = brands?.find((b) => b.workspaceId === null) ?? null;
  const active = brands?.find((b) => b.id === activeId) ?? personal ?? brands?.[0] ?? null;

  const create = (name: string, workspaceId?: string) => {
    setError(null);
    createBrand.mutate(
      { name: name.trim(), workspaceId },
      {
        onSuccess: (b) => {
          setActiveId(b.id);
          setPersonalName("");
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-display text-lg font-semibold tracking-tight">
          Brand
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[260px_1fr]">
        {/* Brand list: personal brand + brands grouped by workspace */}
        <aside className="max-h-64 overflow-y-auto border-b p-3 md:max-h-none md:border-b-0 md:border-r">
          <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
            Your brand
          </p>
          {personal ? (
            <BrandRow
              brand={personal}
              active={active?.id === personal.id}
              onClick={() => setActiveId(personal.id)}
            />
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (personalName.trim()) create(personalName);
              }}
            >
              <Input
                value={personalName}
                onChange={(e) => setPersonalName(e.target.value)}
                placeholder="Brand name…"
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={createBrand.isPending}>
                <Plus />
              </Button>
            </form>
          )}

          {(workspaces ?? []).map((w) => (
            <WorkspaceBrands
              key={w.id}
              workspaceId={w.id}
              workspaceName={w.name}
              brands={(brands ?? []).filter((b) => b.workspaceId === w.id)}
              activeId={active?.id ?? null}
              onSelect={setActiveId}
              onCreate={(name) => create(name, w.id)}
            />
          ))}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : active ? (
            <BrandEditor key={active.id} brand={active} />
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-20 text-center">
              <Store className="h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Set up your brand</h2>
              <p className="text-sm text-muted-foreground">
                Tell the app what you sell and who you sell to. It uses this to
                write on-brand copy, make on-brand images and plan campaigns
                that are built around your real numbers.
              </p>
              <p className="text-xs text-muted-foreground">
                Enter a name on the left to begin.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function BrandRow({
  brand,
  active,
  onClick,
}: {
  brand: BrandDto;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
        active && "bg-accent",
      )}
    >
      <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{brand.name}</span>
    </button>
  );
}

function WorkspaceBrands({
  workspaceName,
  brands,
  activeId,
  onSelect,
  onCreate,
}: {
  workspaceId: string;
  workspaceName: string;
  brands: BrandDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="mt-4">
      <p className="truncate px-1 pb-1.5 text-xs font-medium text-muted-foreground">
        {workspaceName}
      </p>
      {brands.map((b) => (
        <BrandRow
          key={b.id}
          brand={b}
          active={activeId === b.id}
          onClick={() => onSelect(b.id)}
        />
      ))}
      <form
        className="mt-1 flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!name.trim()) return;
          onCreate(name);
          setName("");
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a brand…"
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" variant="ghost" aria-label="Add brand">
          <Plus />
        </Button>
      </form>
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

interface FormState {
  name: string;
  category: string;
  description: string;
  location: string;
  stage: string;
  offer: string;
  avgPrice: string;
  avgCost: string;
  customers: string;
  painPoints: string;
  differentiator: string;
  channels: string[];
  monthlyOrders: string;
  monthlyRevenue: string;
  goalRevenue: string;
  goalDays: string;
  monthlyBudget: string;
  problems: string;
  competitors: string;
  colors: string[];
  tagline: string;
  tone: string;
}

const n2s = (n: number | undefined) => (n === undefined ? "" : String(n));
const s2n = (s: string) => {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function toForm(b: BrandDto): FormState {
  const p = b.profile;
  return {
    name: b.name,
    category: b.category ?? "",
    description: p.description ?? "",
    location: p.location ?? "",
    stage: p.stage ?? "",
    offer: p.offer ?? "",
    avgPrice: n2s(p.avgPrice),
    avgCost: n2s(p.avgCost),
    customers: p.customers ?? "",
    painPoints: p.painPoints ?? "",
    differentiator: p.differentiator ?? "",
    channels: p.channels ?? [],
    monthlyOrders: n2s(p.monthlyOrders),
    monthlyRevenue: n2s(p.monthlyRevenue),
    goalRevenue: n2s(p.goalRevenue),
    goalDays: n2s(p.goalDays),
    monthlyBudget: n2s(p.monthlyBudget),
    problems: p.problems ?? "",
    competitors: p.competitors ?? "",
    colors: p.colors ?? [],
    tagline: p.tagline ?? "",
    tone: p.tone ?? "",
  };
}

function toProfile(f: FormState): BrandProfile {
  const str = (s: string) => (s.trim() ? s.trim() : undefined);
  const goalDays = s2n(f.goalDays);
  return {
    description: str(f.description),
    location: str(f.location),
    stage: str(f.stage),
    offer: str(f.offer),
    avgPrice: s2n(f.avgPrice),
    avgCost: s2n(f.avgCost),
    customers: str(f.customers),
    painPoints: str(f.painPoints),
    differentiator: str(f.differentiator),
    channels: f.channels.length ? f.channels : undefined,
    monthlyOrders: s2n(f.monthlyOrders),
    monthlyRevenue: s2n(f.monthlyRevenue),
    goalRevenue: s2n(f.goalRevenue),
    goalDays: goalDays !== undefined ? Math.max(1, Math.round(goalDays)) : undefined,
    monthlyBudget: s2n(f.monthlyBudget),
    problems: str(f.problems),
    competitors: str(f.competitors),
    colors: f.colors.length ? f.colors : undefined,
    tagline: str(f.tagline),
    tone: str(f.tone),
  };
}

function BrandEditor({ brand }: { brand: BrandDto }) {
  const router = useRouter();
  const update = useUpdateBrand();
  const del = useDeleteBrand();
  const { setBrandId, setDraft } = useBrandMode();
  const { startNewChat } = useStudio();
  const [form, setForm] = useState<FormState>(() => toForm(brand));
  const [saved, setSaved] = useState<FormState>(() => toForm(brand));
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const snapshot = useMemo(() => computeBrandSnapshot(toProfile(form)), [form]);

  const save = () => {
    setError(null);
    update.mutate(
      {
        id: brand.id,
        name: form.name.trim() || brand.name,
        category: form.category.trim(),
        profile: toProfile(form),
      },
      {
        onSuccess: () => setSaved(form),
        onError: (e) => setError(e.message),
      },
    );
  };

  const buildStrategy = () => {
    setBrandId(brand.id);
    setDraft("/campaign ");
    startNewChat();
    router.push("/");
  };

  const toggleChannel = (c: string) =>
    set(
      "channels",
      form.channels.includes(c)
        ? form.channels.filter((x) => x !== c)
        : [...form.channels, c],
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className="h-10 max-w-xs text-base font-semibold"
          aria-label="Brand name"
        />
        <Input
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          placeholder="Category / niche — e.g. Food & beverage"
          className="h-10 max-w-xs"
          aria-label="Category"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="Delete brand"
            onClick={() => {
              if (window.confirm(`Delete "${brand.name}" and everything in it?`)) {
                del.mutate(brand.id);
              }
            }}
          >
            <Trash2 />
          </Button>
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending && <Loader2 className="animate-spin" />}
            {dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Section
        title="Your numbers"
        hint="Worked out from your answers below — plain arithmetic, no guesses."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Profit margin" value={snapshot.marginPct} suffix="%" />
          <Stat label="Profit per order" value={snapshot.grossPerOrder} />
          <Stat label="Orders needed for goal" value={snapshot.ordersNeeded} />
          <Stat label="Orders per day needed" value={snapshot.ordersPerDay} />
          <Stat
            label="Most you can spend to win a customer"
            value={snapshot.breakEvenCac}
          />
          <Stat
            label="Ad budget per order at goal"
            value={snapshot.budgetPerOrder}
          />
        </div>
        {snapshot.revenueGapPerMonth !== null && (
          <p className="mt-3 text-xs text-muted-foreground">
            To hit your goal you need about{" "}
            <b className="text-foreground">
              {snapshot.revenueGapPerMonth.toLocaleString()}
            </b>{" "}
            more revenue per month than you make now.
          </p>
        )}
        {snapshot.budgetPerOrder !== null &&
          snapshot.breakEvenCac !== null &&
          snapshot.budgetPerOrder > snapshot.breakEvenCac && (
            <p className="mt-2 text-xs text-destructive">
              Your budget works out to more per order than the profit on an order —
              you would lose money on first orders. Raise the price, cut costs or
              plan for repeat purchases.
            </p>
          )}
      </Section>

      <Section title="About the business">
        <Q label="What does your business do?">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="e.g. We make small-batch pickles from family recipes and deliver across Hyderabad."
          />
        </Q>
        <Q label="Where do you sell? (city, region or online)">
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Q>
        <Q label="How long have you been running?">
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <Chip key={s} on={form.stage === s} onClick={() => set("stage", form.stage === s ? "" : s)}>
                {s}
              </Chip>
            ))}
          </div>
        </Q>
      </Section>

      <Section title="What you sell">
        <Q label="Your main products or services">
          <Textarea rows={2} value={form.offer} onChange={(e) => set("offer", e.target.value)} />
        </Q>
        <div className="grid gap-3 sm:grid-cols-2">
          <Q label="Average selling price">
            <Input inputMode="decimal" value={form.avgPrice} onChange={(e) => set("avgPrice", e.target.value)} />
          </Q>
          <Q label="Average cost to you (making + delivery)">
            <Input inputMode="decimal" value={form.avgCost} onChange={(e) => set("avgCost", e.target.value)} />
          </Q>
        </div>
      </Section>

      <Section title="Your customers">
        <Q label="Who buys from you?">
          <Textarea rows={2} value={form.customers} onChange={(e) => set("customers", e.target.value)} />
        </Q>
        <Q label="What problem do you solve for them?">
          <Textarea rows={2} value={form.painPoints} onChange={(e) => set("painPoints", e.target.value)} />
        </Q>
        <Q label="Why do they choose you over others?">
          <Textarea rows={2} value={form.differentiator} onChange={(e) => set("differentiator", e.target.value)} />
        </Q>
      </Section>

      <Section title="How you sell today">
        <Q label="Where do you sell and promote?">
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => (
              <Chip key={c} on={form.channels.includes(c)} onClick={() => toggleChannel(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </Q>
        <div className="grid gap-3 sm:grid-cols-2">
          <Q label="Orders per month now">
            <Input inputMode="decimal" value={form.monthlyOrders} onChange={(e) => set("monthlyOrders", e.target.value)} />
          </Q>
          <Q label="Revenue per month now">
            <Input inputMode="decimal" value={form.monthlyRevenue} onChange={(e) => set("monthlyRevenue", e.target.value)} />
          </Q>
        </div>
      </Section>

      <Section title="What you want to achieve">
        <div className="grid gap-3 sm:grid-cols-3">
          <Q label="Revenue goal">
            <Input inputMode="decimal" value={form.goalRevenue} onChange={(e) => set("goalRevenue", e.target.value)} />
          </Q>
          <Q label="In how many days?">
            <Input inputMode="numeric" value={form.goalDays} onChange={(e) => set("goalDays", e.target.value)} />
          </Q>
          <Q label="Marketing budget per month">
            <Input inputMode="decimal" value={form.monthlyBudget} onChange={(e) => set("monthlyBudget", e.target.value)} />
          </Q>
        </div>
      </Section>

      <Section title="What is holding sales back?">
        <Q label="Your biggest problems">
          <Textarea
            rows={3}
            value={form.problems}
            onChange={(e) => set("problems", e.target.value)}
            placeholder="e.g. Few repeat buyers, low Instagram reach, customers ask for discounts…"
          />
        </Q>
        <Q label="Main competitors">
          <Textarea rows={2} value={form.competitors} onChange={(e) => set("competitors", e.target.value)} />
        </Q>
      </Section>

      <Section title="Look and voice">
        <Q label="Brand colours">
          <div className="flex flex-wrap items-center gap-2">
            {form.colors.map((c, i) => (
              <span key={`${c}-${i}`} className="flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5">
                <input
                  type="color"
                  value={c}
                  onChange={(e) =>
                    set("colors", form.colors.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  aria-label={`Colour ${i + 1}`}
                />
                <span className="font-mono text-[11px]">{c}</span>
                <button
                  onClick={() => set("colors", form.colors.filter((_, j) => j !== i))}
                  aria-label="Remove colour"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </span>
            ))}
            {form.colors.length < 6 && (
              <Button variant="outline" size="sm" onClick={() => set("colors", [...form.colors, "#c0392b"])}>
                <Plus /> Add colour
              </Button>
            )}
          </div>
        </Q>
        <div className="grid gap-3 sm:grid-cols-2">
          <Q label="Tagline">
            <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Q>
          <Q label="Tone of voice">
            <Input
              value={form.tone}
              onChange={(e) => set("tone", e.target.value)}
              placeholder="e.g. warm, playful, premium"
            />
          </Q>
        </div>
      </Section>

      <AssetsSection brand={brand} />
      <DocumentsSection brand={brand} />

      <div className="flex flex-col items-start gap-2 rounded-xl border bg-accent/30 p-4">
        <p className="text-sm font-medium">Ready for a plan?</p>
        <p className="text-xs text-muted-foreground">
          Opens a chat in your brand with the campaign builder. It already knows
          everything above, so it only asks what is missing.
        </p>
        <Button onClick={buildStrategy} disabled={dirty}>
          <Megaphone /> Build my sales strategy
        </Button>
        {dirty && (
          <p className="text-xs text-muted-foreground">Save your changes first.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ assets + docs ------------------------------ */

function AssetsSection({ brand }: { brand: BrandDto }) {
  const add = useAddBrandAsset();
  const remove = useDeleteBrandAsset();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList, kind: "logo" | "product") => {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const { url } = await apiFetch<{ url: string }>("/uploads", {
          method: "POST",
          body: form,
        });
        await add.mutateAsync({ brandId: brand.id, url, kind, label: file.name });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Logo and photos"
      hint="Used as references so generated images look like your brand. Up to 20."
    >
      <div className="flex flex-wrap gap-2">
        <FilePick accept="image/*" label="Add logo" busy={busy} onFiles={(f) => upload(f, "logo")} />
        <FilePick accept="image/*" multiple label="Add product photos" busy={busy} onFiles={(f) => upload(f, "product")} />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {brand.assets.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {brand.assets.map((a) => (
            <div key={a.id} className="group relative aspect-square overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.label ?? a.kind} className="h-full w-full object-cover" />
              <Badge variant="default" className="absolute left-1 top-1 text-[9px]">
                {a.kind}
              </Badge>
              <button
                onClick={() => remove.mutate({ brandId: brand.id, assetId: a.id })}
                className="absolute right-1 top-1 rounded-full bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DocumentsSection({ brand }: { brand: BrandDto }) {
  const qc = useQueryClient();
  const { data: docs } = useBrandDocuments(brand.id);
  const remove = useDeleteDocument();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList) => {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        // Fields must precede the file for the multipart parser to see them.
        form.append("brandId", brand.id);
        form.append("file", file);
        await apiFetch("/documents", { method: "POST", body: form });
      }
      await qc.invalidateQueries({ queryKey: ["documents", "brand", brand.id] });
      await qc.invalidateQueries({ queryKey: ["brands"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Documents"
      hint="Brand guidelines, price lists, past campaigns, customer feedback (PDF or Word). The chat searches them whenever brand mode is on. Up to 10."
    >
      <FilePick accept={DOC_ACCEPT} multiple label="Upload documents" busy={busy} onFiles={upload} icon="doc" />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {docs && docs.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{d.filename}</span>
              <span
                className={cn(
                  "text-[11px]",
                  d.status === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
                title={d.error ?? undefined}
              >
                {d.status === "processing" ? "reading…" : d.status === "ready" ? "ready" : (d.error ?? "failed")}
              </span>
              <button
                onClick={() =>
                  remove.mutate(d.id, {
                    onSuccess: () => {
                      qc.invalidateQueries({ queryKey: ["documents", "brand", brand.id] });
                      qc.invalidateQueries({ queryKey: ["brands"] });
                    },
                  })
                }
                aria-label={`Remove ${d.filename}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* --------------------------------- pieces --------------------------------- */

function FilePick({
  accept,
  label,
  multiple,
  busy,
  onFiles,
  icon,
}: {
  accept: string;
  label: string;
  multiple?: boolean;
  busy: boolean;
  onFiles: (files: FileList) => void;
  icon?: "doc";
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent",
        busy && "pointer-events-none opacity-60",
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : icon === "doc" ? (
        <Upload className="h-4 w-4" />
      ) : (
        <ImagePlus className="h-4 w-4" />
      )}
      {label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Q({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        on
          ? "border-primary bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">
        {value === null ? "—" : `${value.toLocaleString()}${suffix ?? ""}`}
      </p>
    </div>
  );
}
