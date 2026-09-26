"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, FileText, ImagePlus, Loader2, SkipForward, Trash2, Upload } from "lucide-react";
import {
  GUAVA_INDUSTRIES,
  getGuavaIndustry,
  guavaSectionsFor,
  type BrandDto,
  type GuavaProfileDto,
  type GuavaSection,
  type GuavaSectionStatus,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useSaveGuavaProfile } from "@/lib/guava-hooks";
import { useAddBrandAsset, useBrandDocuments, useDeleteBrandAsset, useDeleteDocument } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

const STATUS: Record<GuavaSectionStatus, { label: string; variant: "muted" | "secondary" | "default" | "outline" }> = {
  empty: { label: "Not started", variant: "muted" },
  started: { label: "In progress", variant: "secondary" },
  good: { label: "Looking good", variant: "default" },
  skipped: { label: "Skipped for now", variant: "outline" },
};

const DOC_ACCEPT =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx";

/** The editable business profile: industry, what's missing, and one card per section. */
export function GuavaProfileEditor({
  brand,
  profile,
  openKey,
  onOpenKey,
}: {
  brand: BrandDto;
  profile: GuavaProfileDto;
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
}) {
  const save = useSaveGuavaProfile(brand.id);
  const sections = useMemo(() => guavaSectionsFor(profile.industry), [profile.industry]);
  const { completeness } = profile;
  const industry = getGuavaIndustry(profile.industry);

  const setIndustry = (key: string | null) =>
    save.mutate({ industry: key }, { onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor="guava-industry">
              What kind of business is this?
            </label>
            <Select
              id="guava-industry"
              value={profile.industry ?? ""}
              disabled={!profile.canEdit || save.isPending}
              onChange={(e) => setIndustry(e.target.value || null)}
            >
              <option value="">Choose one…</option>
              {GUAVA_INDUSTRIES.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </Select>
          </div>
          {!profile.industry && profile.suggestedIndustry && profile.canEdit && (
            <Button variant="outline" size="sm" onClick={() => setIndustry(profile.suggestedIndustry)}>
              Looks like: {getGuavaIndustry(profile.suggestedIndustry).label}. Use it
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {profile.industry
            ? `Guava has added a few questions that matter for ${industry.label.toLowerCase()}.`
            : "Picking a type adds the questions that matter most for it. You can change it any time."}
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Profile completeness</h2>
          <span className="text-sm tabular-nums text-muted-foreground">{completeness.pct}%</span>
        </div>
        <Progress value={completeness.pct} className="mt-2" />
        {completeness.missing.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              Guava can diagnose with what it has. These answers would sharpen it most:
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {completeness.missing.slice(0, 5).map((m) => (
                <li key={`${m.section}.${m.field}`}>
                  <button
                    type="button"
                    onClick={() => onOpenKey(m.section)}
                    className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    {m.question}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Everything Guava usually asks for is filled in.</p>
        )}
      </Card>

      {sections.map((section) => (
        <SectionCard
          key={section.key}
          brand={brand}
          profile={profile}
          section={section}
          open={openKey === section.key}
          onToggle={() => onOpenKey(openKey === section.key ? null : section.key)}
        />
      ))}
    </div>
  );
}

function SectionCard({
  brand,
  profile,
  section,
  open,
  onToggle,
}: {
  brand: BrandDto;
  profile: GuavaProfileDto;
  section: GuavaSection;
  open: boolean;
  onToggle: () => void;
}) {
  const progress = profile.completeness.sections.find((s) => s.key === section.key);
  const status = STATUS[progress?.status ?? "empty"];
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{section.title}</div>
          <div className="truncate text-xs text-muted-foreground">{section.description}</div>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-4 py-4">
          <SectionForm
            // Remount after each save so the form starts from what the server now holds.
            key={profile.updatedAt ?? "new"}
            brand={brand}
            profile={profile}
            section={section}
          />
        </div>
      )}
    </Card>
  );
}

function SectionForm({
  brand,
  profile,
  section,
}: {
  brand: BrandDto;
  profile: GuavaProfileDto;
  section: GuavaSection;
}) {
  const save = useSaveGuavaProfile(brand.id);
  const initial = profile.values[section.key] ?? {};
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const readOnly = !profile.canEdit;
  const skipped = profile.skipped.includes(section.key);

  const changed = section.fields.filter((f) => (draft[f.key] ?? "") !== (initial[f.key] ?? ""));

  const submit = () => {
    const values: Record<string, string> = {};
    for (const f of changed) values[f.key] = draft[f.key] ?? "";
    save.mutate(
      { values: { [section.key]: values }, skipped: profile.skipped.filter((s) => s !== section.key) },
      { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(e.message) },
    );
  };
  const toggleSkip = () =>
    save.mutate(
      { skipped: skipped ? profile.skipped.filter((s) => s !== section.key) : [...profile.skipped, section.key] },
      { onError: (e) => toast.error(e.message) },
    );

  return (
    <div className="space-y-4">
      {section.fields.map((f) => {
        const fromBrand = profile.inheritedKeys.includes(`${section.key}.${f.key}`) && draft[f.key] === initial[f.key];
        const id = `guava-${section.key}-${f.key}`;
        return (
          <div key={f.key}>
            <div className="mb-1 flex items-center gap-2">
              <label htmlFor={id} className="text-sm font-medium">
                {f.label}
              </label>
              {fromBrand && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">from your Brand</span>
              )}
            </div>
            {f.hint && <p className="mb-1.5 text-xs text-muted-foreground">{f.hint}</p>}
            {f.kind === "long" ? (
              <Textarea
                id={id}
                rows={3}
                maxLength={2000}
                disabled={readOnly}
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ) : (
              <Input
                id={id}
                maxLength={2000}
                disabled={readOnly}
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            )}
          </div>
        );
      })}

      {section.key === "additional" && <FilesAndDocuments brand={brand} readOnly={readOnly} />}

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={submit} disabled={!changed.length || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={toggleSkip} disabled={save.isPending}>
            <SkipForward className="h-4 w-4" />
            {skipped ? "Ask me about this again" : "Skip for now"}
          </Button>
          {changed.length > 0 && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the owner can edit this profile.</p>
      )}
    </div>
  );
}

/** Uploaded documents (the brand's knowledge base) and photos - both help Guava understand the business. */
function FilesAndDocuments({ brand, readOnly }: { brand: BrandDto; readOnly: boolean }) {
  const qc = useQueryClient();
  const { data: docs } = useBrandDocuments(brand.id);
  const removeDoc = useDeleteDocument();
  const addAsset = useAddBrandAsset();
  const removeAsset = useDeleteBrandAsset();
  const [busy, setBusy] = useState<"doc" | "img" | null>(null);
  const photos = brand.assets.filter((a) => a.kind === "reference");

  const uploadDocs = async (files: FileList) => {
    setBusy("doc");
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
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const uploadPhotos = async (files: FileList) => {
    setBusy("img");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const { url } = await apiFetch<{ url: string }>("/uploads", { method: "POST", body: form });
        await addAsset.mutateAsync({
          brandId: brand.id,
          url,
          kind: "reference",
          label: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-dashed p-3">
      <div>
        <div className="text-sm font-medium">Documents</div>
        <p className="mb-2 text-xs text-muted-foreground">
          Price lists, brochures, past campaigns, customer feedback (PDF or Word). Also searchable in chat when brand
          mode is on.
        </p>
        {!readOnly && <PickButton icon="doc" label="Add documents" accept={DOC_ACCEPT} busy={busy === "doc"} onFiles={uploadDocs} />}
        {docs && docs.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                <span className="text-[11px] text-muted-foreground">
                  {d.status === "processing" ? "reading…" : d.status === "ready" ? "ready" : (d.error ?? "failed")}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${d.filename}`}
                    onClick={() => removeDoc.mutate(d.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-sm font-medium">Photos</div>
        <p className="mb-2 text-xs text-muted-foreground">
          Your shop, products, menu or project. They are saved with your Brand too. Logos and fonts stay on the{" "}
          <Link href="/brand" className="underline">
            Brand page
          </Link>
          .
        </p>
        {!readOnly && <PickButton icon="img" label="Add photos" accept="image/*" busy={busy === "img"} onFiles={uploadPhotos} />}
        {photos.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {photos.map((a) => (
              <li key={a.id} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.label ?? "Business photo"} className="h-16 w-16 rounded-md border object-cover" />
                {!readOnly && (
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => removeAsset.mutate({ brandId: brand.id, assetId: a.id })}
                    className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PickButton({
  icon,
  label,
  accept,
  busy,
  onFiles,
}: {
  icon: "doc" | "img";
  label: string;
  accept: string;
  busy: boolean;
  onFiles: (files: FileList) => void;
}) {
  const Icon = busy ? Loader2 : icon === "doc" ? Upload : ImagePlus;
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <Icon className={cn("h-4 w-4", busy && "animate-spin")} />
      {label}
      <input
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}
