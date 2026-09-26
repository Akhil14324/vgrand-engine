"use client";

import { useEffect, useState } from "react";
import { Loader2, Stamp, Trash2, Upload } from "lucide-react";
import { LOGO_CORNERS, type BrandDto, type GenerationDto, type LogoCorner } from "@catgpt/types";
import { useBrands, useDeleteBrandAsset, useUpdateBrand } from "@/lib/hooks";
import { useApplyBrandKit, useUploadBrandFont } from "@/lib/brand-kit-hooks";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const CORNER_LABEL: Record<LogoCorner, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

const DEFAULT_PLACEMENT = { corner: "bottom-right" as LogoCorner, sizePct: 18, marginPct: 4 };

/** Brand page section: where the real logo goes, which fonts to use, and auto-stamping. */
export function BrandKitSection({ brand }: { brand: BrandDto }) {
  const update = useUpdateBrand();
  const upload = useUploadBrandFont();
  const removeAsset = useDeleteBrandAsset();

  const logo = brand.assets.find((a) => a.kind === "logo");
  const fonts = brand.assets.filter((a) => a.kind === "font");
  const saved = brand.profile;

  const [placement, setPlacement] = useState(saved.logoPlacement ?? DEFAULT_PLACEMENT);
  const [heading, setHeading] = useState(saved.fonts?.heading ?? "");
  const [body, setBody] = useState(saved.fonts?.body ?? "");
  const [auto, setAuto] = useState(!!saved.overlayDefault);

  // A removed font can no longer be selected.
  const has = (id: string) => fonts.some((f) => f.id === id);
  useEffect(() => {
    if (heading && !has(heading)) setHeading("");
    if (body && !has(body)) setBody("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts.length]);

  const dirty =
    JSON.stringify(placement) !== JSON.stringify(saved.logoPlacement ?? DEFAULT_PLACEMENT) ||
    heading !== (saved.fonts?.heading ?? "") ||
    body !== (saved.fonts?.body ?? "") ||
    auto !== !!saved.overlayDefault;

  const save = () =>
    update.mutate(
      {
        id: brand.id,
        profile: {
          ...saved,
          logoPlacement: placement,
          fonts: { heading: heading || undefined, body: body || undefined },
          overlayDefault: auto && !!logo,
        },
      },
      {
        onSuccess: () => toast.success("Brand kit saved"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the brand kit"),
      },
    );

  const onFont = (files: FileList) => {
    const file = files[0];
    if (!file) return;
    upload.mutate(
      { brandId: brand.id, file },
      {
        onSuccess: (asset) => {
          toast.success(`Added font "${asset.label}"`);
          // First font becomes the heading font so the kit works straight away.
          if (!heading) setHeading(asset.id);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Font upload failed"),
      },
    );
  };

  const isTop = placement.corner.startsWith("top");
  const isLeft = placement.corner.endsWith("left");

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-semibold">Brand kit</h2>
        <p className="text-xs text-muted-foreground">
          Your real logo file and fonts are placed on images after they are generated, so the logo is never
          redrawn or distorted by AI.
        </p>
      </div>

      {!logo && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Add a logo under &ldquo;Logo and photos&rdquo; first. Then choose where it goes below.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Logo position
            <Select
              value={placement.corner}
              onChange={(e) => setPlacement({ ...placement, corner: e.target.value as LogoCorner })}
            >
              {LOGO_CORNERS.map((c) => (
                <option key={c} value={c}>
                  {CORNER_LABEL[c]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Logo size: {placement.sizePct}% of image width
            <input
              type="range"
              min={6}
              max={40}
              value={placement.sizePct}
              onChange={(e) => setPlacement({ ...placement, sizePct: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Edge margin: {placement.marginPct}%
            <input
              type="range"
              min={1}
              max={12}
              value={placement.marginPct}
              onChange={(e) => setPlacement({ ...placement, marginPct: Number(e.target.value) })}
            />
          </label>
        </div>

        {/* Approximate preview (4:5). The server applies the exact same rules. */}
        <div
          aria-label="Logo placement preview"
          className="relative aspect-[4/5] w-full overflow-hidden rounded-lg border bg-gradient-to-br from-muted to-accent"
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo.url}
              alt="Logo preview"
              className="absolute h-auto object-contain"
              style={{
                width: `${placement.sizePct}%`,
                ...(isLeft ? { left: `${placement.marginPct}%` } : { right: `${placement.marginPct}%` }),
                ...(isTop ? { top: `${placement.marginPct * 0.8}%` } : { bottom: `${placement.marginPct * 0.8}%` }),
              }}
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
              No logo yet
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Stamp the logo on every new brand image</p>
          <p className="text-xs text-muted-foreground">
            Applies to fresh generations and campaign creatives. Edits of an existing image are left alone.
          </p>
        </div>
        <Switch checked={auto && !!logo} onCheckedChange={setAuto} disabled={!logo} aria-label="Auto-stamp logo" />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fonts</h3>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent">
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload font
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              disabled={upload.isPending}
              onChange={(e) => {
                if (e.target.files?.length) onFont(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {fonts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No fonts uploaded. Headline and CTA text will use a clean default (Latin letters only). If your
            brand uses Hindi, Telugu or another script, upload a font that includes it.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Headline font
                <Select value={heading} onChange={(e) => setHeading(e.target.value)}>
                  <option value="">Default</option>
                  {fonts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label ?? "Font"}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Button / body font
                <Select value={body} onChange={(e) => setBody(e.target.value)}>
                  <option value="">Same as headline</option>
                  {fonts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label ?? "Font"}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <ul className="flex flex-wrap gap-2">
              {fonts.map((f) => (
                <li key={f.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  {f.label ?? "Font"}
                  <button
                    onClick={() => removeAsset.mutate({ brandId: brand.id, assetId: f.id })}
                    aria-label={`Remove ${f.label ?? "font"}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">Only upload fonts you have the licence to use.</p>
          </>
        )}
      </div>

      <div>
        <Button onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" />}
          Save brand kit
        </Button>
      </div>
    </section>
  );
}

/** Per-image action: stamp the brand's logo (and optional headline / CTA) onto a finished image. */
export function ApplyBrandKitButton({ generation }: { generation: GenerationDto }) {
  const { data: brands } = useBrands();
  const chosen = useBrandMode((s) => s.brandId);
  const apply = useApplyBrandKit();
  const [open, setOpen] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [logo, setLogo] = useState(true);
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState("");

  const usable = brands ?? [];
  const active = resolveActiveBrand(brands, chosen);
  const selected = usable.find((b) => b.id === (brandId || active?.id || usable[0]?.id));
  if (!usable.length) return null;

  const hasLogo = !!selected?.assets.some((a) => a.kind === "logo");
  const canApply = !!selected && ((logo && hasLogo) || headline.trim() || cta.trim());

  const submit = () => {
    if (!selected) return;
    apply.mutate(
      {
        generationId: generation.id,
        brandId: selected.id,
        logo,
        headline: headline.trim() || undefined,
        cta: cta.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Brand kit applied - saved as a new image, the original is untouched");
          setOpen(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't apply the brand kit"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setCta(selected?.profile.defaultCta ?? "");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Apply brand kit">
              <Stamp />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Apply brand kit</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply brand kit</DialogTitle>
          <DialogDescription>
            Adds your real logo and optional text in your brand fonts. Saved as a new image; the original stays.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Brand
            <Select value={selected?.id ?? ""} onChange={(e) => setBrandId(e.target.value)}>
              {usable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              Add logo
              {!hasLogo && <span className="ml-1 text-xs text-muted-foreground">(this brand has no logo yet)</span>}
            </span>
            <Switch checked={logo && hasLogo} onCheckedChange={setLogo} disabled={!hasLogo} aria-label="Add logo" />
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Headline (optional)
            <Input value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} placeholder="Fresh drops this Friday" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Button text (optional)
            <Input value={cta} maxLength={40} onChange={(e) => setCta(e.target.value)} placeholder="Shop now" />
          </label>
          <Button onClick={submit} disabled={!canApply || apply.isPending}>
            {apply.isPending && <Loader2 className="animate-spin" />}
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
