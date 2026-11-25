"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Plus } from "lucide-react";
import type { WaNumberDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWaNumbers } from "@/lib/whatsapp-hooks";
import { BotSettings } from "./bot-settings";
import { BroadcastsTab } from "./broadcasts-tab";
import { ConnectCard, ConnectionTab } from "./connection";
import { InboxTab } from "./inbox-tab";
import { TemplatesTab } from "./templates-tab";

export function WhatsappView() {
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
            <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">WhatsApp</h1>
            <p className="truncate text-xs text-muted-foreground">One number per brand: a lead bot, a team inbox and approved broadcasts</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-4 sm:py-6">
            <Body />
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

function Body() {
  const numbers = useWaNumbers();
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (numbers.isLoading) return <Skeleton className="h-40 w-full" />;
  const list = numbers.data ?? [];
  if (!list.length || adding) return <ConnectCard first={!list.length} onDone={() => setAdding(false)} onCancel={list.length ? () => setAdding(false) : undefined} />;
  const current: WaNumberDto = list.find((n) => n.id === pick) ?? list[0]!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-auto min-w-56" value={current.id} onChange={(e) => setPick(e.target.value)} aria-label="Brand number">
          {list.map((n) => (
            <option key={n.id} value={n.id}>
              {n.brandName} · {n.displayPhone ?? n.phoneNumberId}
            </option>
          ))}
        </Select>
        <Badge variant={current.status === "active" ? "secondary" : "destructive"}>{current.status === "active" ? "Connected" : "Reconnect needed"}</Badge>
        <Badge variant="muted">Bot: {current.botMode}</Badge>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add brand number
        </Button>
      </div>
      {current.status !== "active" && (
        <Card className="flex items-start gap-2 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          Meta rejected the saved access token. Open the Connection tab and reconnect with a fresh token; messages are not being sent or answered until then.
        </Card>
      )}
      <Tabs defaultValue="inbox" key={current.id}>
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="bot">Bot</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox"><InboxTab number={current} /></TabsContent>
        <TabsContent value="bot"><BotSettings number={current} /></TabsContent>
        <TabsContent value="templates"><TemplatesTab number={current} /></TabsContent>
        <TabsContent value="broadcasts"><BroadcastsTab number={current} /></TabsContent>
        <TabsContent value="connection"><ConnectionTab number={current} /></TabsContent>
      </Tabs>
    </div>
  );
}
