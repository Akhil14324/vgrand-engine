"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Compass, Instagram, Loader2, Plus, X } from "lucide-react";
import { GUAVA_MAX_COMPETITORS } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useBrands, useConnectSocial, useSocialAccounts } from "@/lib/hooks";
import { useInstagramSetup, useSaveInstagramSetup } from "@/lib/guava-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";

/**
 * Brand Engine → Instagram: your one Instagram account and up to three rival
 * accounts. Nothing is per brand here: Brand Strategist splits your account's
 * posts by brand and shows the review for whichever brand you pick there.
 */
export function InstagramSetupView() {
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
            <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Instagram</h1>
            <p className="truncate text-xs text-muted-foreground">Your account and up to 3 rival accounts</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4 sm:py-6">
            <SetupForm />
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

function SetupForm() {
  // Workspace brands share their workspace's setup; personal brands share yours.
  const { data: brands, isLoading: brandsLoading } = useBrands();
  const chosen = useBrandMode((s) => s.brandId);
  const workspaceId = (resolveActiveBrand(brands, chosen) ?? brands?.[0])?.workspaceId ?? null;

  const accounts = useSocialAccounts(workspaceId, !brandsLoading);
  const setup = useInstagramSetup(brandsLoading ? null : workspaceId);
  const save = useSaveInstagramSetup();
  const connect = useConnectSocial();

  const igAccounts = useMemo(() => (accounts.data ?? []).filter((a) => a.platform === "instagram"), [accounts.data]);
  const [accountId, setAccountId] = useState("");
  const [rivals, setRivals] = useState<string[]>(["", "", ""]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !setup.data || accounts.isLoading) return;
    setAccountId(setup.data.accountId ?? (igAccounts.length === 1 ? igAccounts[0]!.id : ""));
    const saved = setup.data.competitors.map((h) => `@${h}`);
    setRivals([...saved, "", "", ""].slice(0, GUAVA_MAX_COMPETITORS));
    setLoaded(true);
  }, [loaded, setup.data, accounts.isLoading, igAccounts]);

  if (brandsLoading || setup.isLoading || accounts.isLoading || !loaded) return <Skeleton className="h-72 w-full" />;
  const canEdit = setup.data?.canEdit ?? false;
  const norm = (list: string[]) => list.map((r) => r.trim().replace(/^@/, "").toLowerCase()).filter(Boolean).join(",");
  const dirty = accountId !== (setup.data?.accountId ?? "") || norm(rivals) !== (setup.data?.competitors ?? []).join(",");

  const onSave = () =>
    save.mutate(
      { workspaceId, accountId: accountId || null, competitors: rivals.map((r) => r.trim()).filter(Boolean) },
      { onSuccess: () => toast.success("Instagram saved"), onError: (e) => toast.error(e.message) },
    );
  const onConnect = () =>
    connect.mutate({ platform: "instagram", workspaceId }, { onError: (e) => toast.error(e.message) });

  return (
    <Card className="space-y-5 p-4 sm:p-6">
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Instagram className="h-5 w-5 text-primary" /> Your Instagram account
        </div>
        {igAccounts.length ? (
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!canEdit}>
            <option value="">Not set</option>
            {igAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle ?? a.displayName ?? "instagram"}
                {a.status !== "active" ? " (reconnect needed)" : ""}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-muted-foreground">Connect your Instagram Business or Creator account (linked to a Facebook Page).</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={igAccounts.length ? "outline" : "default"} disabled={connect.isPending || !canEdit} onClick={onConnect}>
            <Plus className="h-4 w-4" /> {igAccounts.length ? "Connect a different account" : "Connect Instagram"}
          </Button>
          {setup.data?.accountHandle && <Badge variant="secondary">Saved: @{setup.data.accountHandle}</Badge>}
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="font-semibold">Rival accounts (up to {GUAVA_MAX_COMPETITORS})</div>
        {rivals.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={r}
              placeholder={`Rival ${i + 1}: @handle or instagram.com/link`}
              disabled={!canEdit}
              onChange={(e) => setRivals((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
            {r && canEdit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Clear rival ${i + 1}`}
                onClick={() => setRivals((prev) => prev.map((v, j) => (j === i ? "" : v)))}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Rivals must be public Business or Creator accounts.</p>
      </div>

      <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        You don&apos;t set anything per brand. In Brand Strategist, pick Vgrand Infra, Planet, Restaurant or any other brand: Gemini
        picks that brand&apos;s posts out of this account and reviews them against that brand and your rivals.
      </p>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center">
        <Button onClick={onSave} disabled={!canEdit || !dirty || save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </Button>
        <Button variant="outline" asChild>
          <Link href="/guava">
            <Compass className="h-4 w-4" /> See results in Brand Strategist
          </Link>
        </Button>
        {!canEdit && <span className="text-xs text-muted-foreground">Only the workspace owner can change this.</span>}
      </div>
    </Card>
  );
}
