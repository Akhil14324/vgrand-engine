"use client";

import { Store } from "lucide-react";
import { useBrands, useWorkspaces } from "@/lib/hooks";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { Select } from "@/components/ui/select";

/**
 * The active brand for the whole app (composer, brand-aware pages). Shares
 * state with the composer's Brand toggle, so both always agree.
 */
export function BrandSwitcher() {
  const { data: brands } = useBrands();
  const { data: workspaces } = useWorkspaces();
  const chosen = useBrandMode((s) => s.brandId);
  const setBrandId = useBrandMode((s) => s.setBrandId);
  if (!brands?.length) return null;

  const active = resolveActiveBrand(brands, chosen);
  const wsName = (id: string | null) => (id ? workspaces?.find((w) => w.id === id)?.name : undefined);

  return (
    <div className="px-3 pt-2">
      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Store className="h-3 w-3" />
        Active brand
      </label>
      <Select
        aria-label="Active brand"
        value={active?.id ?? ""}
        onChange={(e) => setBrandId(e.target.value || null)}
        className="h-9 bg-accent/50 text-sm"
      >
        <option value="">No brand (general)</option>
        {brands.map((b) => {
          const ws = wsName(b.workspaceId);
          return (
            <option key={b.id} value={b.id}>
              {b.name}
              {ws ? ` - ${ws}` : ""}
            </option>
          );
        })}
      </Select>
    </div>
  );
}
