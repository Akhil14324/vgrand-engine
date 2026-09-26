"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, CircleX, Info, Loader2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import type {
  BrandDto,
  ComplianceCheckDto,
  ComplianceSeverity,
  ComplianceStatus,
  GenerationDto,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";
import { useBrands } from "@/lib/hooks";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useComplianceCheck, useRewriteCaption } from "@/lib/brand-compliance-hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const STATUS: Record<ComplianceStatus, { label: string; variant: "default" | "muted" | "destructive"; hint: string }> = {
  pass: { label: "No issues found", variant: "default", hint: "Nothing broke a brand rule and the AI review raised no concerns." },
  attention: { label: "Needs a look", variant: "muted", hint: "Something is worth checking. Nothing here breaks a hard rule." },
  blocked: { label: "Breaks a brand rule", variant: "destructive", hint: "A hard rule failed (a forbidden word or claim). Fix it before posting." },
};

const SEVERITY_ICON: Record<ComplianceSeverity, { Icon: typeof Info; cls: string }> = {
  pass: { Icon: CircleCheck, cls: "text-emerald-600" },
  info: { Icon: Info, cls: "text-muted-foreground" },
  warn: { Icon: CircleAlert, cls: "text-amber-600" },
  fail: { Icon: CircleX, cls: "text-destructive" },
};

/**
 * Findings, kept in two clearly separate groups: exact rule checks, and the
 * AI's opinion. There is deliberately no overall number - visual brand fit is
 * partly subjective.
 */
export function ComplianceResult({ check }: { check: ComplianceCheckDto }) {
  const s = STATUS[check.status];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.variant}>{s.label}</Badge>
        <span className="text-xs text-muted-foreground">{s.hint}</span>
      </div>

      <section className="flex flex-col gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Rule checks <span className="font-normal normal-case">(exact, repeatable)</span>
        </h4>
        <ul className="flex flex-col gap-1.5">
          {check.ruleFindings.map((f) => {
            const { Icon, cls } = SEVERITY_ICON[f.severity];
            return (
              <li key={f.id} className="flex gap-2 text-sm">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cls)} />
                <span>
                  <span className="font-medium">{f.label}.</span> <span className="text-muted-foreground">{f.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3" /> AI review <span className="font-normal normal-case">(an opinion, not a verdict)</span>
        </h4>
        {check.aiFindings ? (
          check.aiFindings.length ? (
            <ul className="flex flex-col gap-1.5">
              {check.aiFindings.map((f) => (
                <li key={f.aspect} className="flex gap-2 text-sm">
                  {f.verdict === "concern" ? (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  ) : (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                  <span>
                    <span className="font-medium">{f.aspect}.</span> <span className="text-muted-foreground">{f.note}</span>
                    {f.suggestion && <span className="block text-xs">Suggestion: {f.suggestion}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">The AI had nothing to add.</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{check.aiSkippedReason ?? "Not run."}</p>
        )}
      </section>
    </div>
  );
}

/** The checker form: pick a brand, give an image and/or caption, get findings. */
export function ComplianceChecker({
  brands,
  generation,
  initialCaption = "",
}: {
  brands: BrandDto[];
  /** When set, checks this existing image instead of an upload. */
  generation?: GenerationDto;
  initialCaption?: string;
}) {
  const chosen = useBrandMode((s) => s.brandId);
  const metaBrand = typeof generation?.metadata?.brandId === "string" ? generation.metadata.brandId : null;
  const [brandId, setBrandId] = useState(
    () => brands.find((b) => b.id === metaBrand)?.id ?? resolveActiveBrand(brands, chosen)?.id ?? brands[0]?.id ?? "",
  );
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState(initialCaption);
  const [instagram, setInstagram] = useState(false);
  const [ai, setAi] = useState(true);
  const [result, setResult] = useState<ComplianceCheckDto | null>(null);

  const check = useComplianceCheck();
  const rewrite = useRewriteCaption();
  const imageUrl = generation?.imageUrls[0] ?? uploadUrl ?? undefined;
  const canRun = !!brandId && (!!imageUrl || caption.trim().length > 0);
  const failedRule = result?.ruleFindings.some((f) => f.severity === "fail" && (f.id === "forbidden_words" || f.id === "forbidden_claims"));

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { url } = await apiFetch<{ url: string }>("/uploads", { method: "POST", body: form });
      setUploadUrl(url);
      setResult(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const run = () =>
    check.mutate(
      {
        brandId,
        ...(generation ? { generationId: generation.id } : uploadUrl ? { imageUrl: uploadUrl } : {}),
        caption: caption.trim() || undefined,
        platforms: instagram ? ["instagram"] : undefined,
        ai,
      },
      {
        onSuccess: setResult,
        onError: (e) => toast.error(e instanceof Error ? e.message : "Check failed"),
      },
    );

  const fixCaption = () =>
    rewrite.mutate(
      { brandId, caption: caption.trim() },
      {
        onSuccess: (r) => {
          setCaption(r.caption);
          setResult(null);
          toast.info(
            r.ruleFindings.some((f) => f.severity === "fail")
              ? "Rewritten, but it still breaks a rule. Check it again."
              : "Caption rewritten. Check it again to confirm.",
          );
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't rewrite"),
      },
    );

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Check against brand
        <Select value={brandId} onChange={(e) => { setBrandId(e.target.value); setResult(null); }}>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </label>

      {generation ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={generation.imageUrls[0]} alt="Image being checked" className="max-h-56 w-auto rounded-md border object-contain" />
      ) : (
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploadUrl ? "Replace image" : "Upload image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {uploadUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadUrl} alt="Uploaded creative" className="h-14 w-14 rounded-md border object-cover" />
          )}
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Caption (optional)
        <textarea
          value={caption}
          onChange={(e) => { setCaption(e.target.value); setResult(null); }}
          rows={3}
          maxLength={5000}
          className="w-full rounded-md border border-input bg-transparent p-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Paste the caption you plan to post"
        />
      </label>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={instagram} onCheckedChange={setInstagram} aria-label="Posting to Instagram" /> Posting to Instagram
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={ai} onCheckedChange={setAi} aria-label="Include AI review" /> Include AI review
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={run} disabled={!canRun || check.isPending}>
          {check.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          Check
        </Button>
        {failedRule && caption.trim() && (
          <Button variant="outline" onClick={fixCaption} disabled={rewrite.isPending}>
            {rewrite.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Rewrite caption to fix
          </Button>
        )}
      </div>

      {result && <ComplianceResult check={result} />}
      {result && !generation && result.status !== "pass" && (
        <p className="text-xs text-muted-foreground">
          To add your real logo or headline to an image, use &ldquo;Apply brand kit&rdquo; on it in the studio.
        </p>
      )}
    </div>
  );
}

/** Per-image action: check a generated image (and its caption) against a brand. */
export function ComplianceCheckButton({ generation }: { generation: GenerationDto }) {
  const { data: brands } = useBrands();
  const [open, setOpen] = useState(false);
  if (!brands?.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Check brand compliance">
              <ShieldCheck />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Check against brand</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Brand compliance check</DialogTitle>
          <DialogDescription>Exact rule checks plus an AI opinion. Nothing here changes your image.</DialogDescription>
        </DialogHeader>
        {open && <ComplianceChecker brands={brands} generation={generation} />}
      </DialogContent>
    </Dialog>
  );
}

/** Brand page section: check any creative (upload + caption), including ones made elsewhere. */
export function ComplianceSection({ brand }: { brand: BrandDto }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-semibold">Check a creative</h2>
        <p className="text-xs text-muted-foreground">
          Upload any image and caption, including ones made elsewhere, and see how they match this brand&rsquo;s rules.
        </p>
      </div>
      <ComplianceChecker key={brand.id} brands={[brand]} />
    </section>
  );
}
