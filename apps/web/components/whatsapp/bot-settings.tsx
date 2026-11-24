"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { WA_BOT_MODES, WA_MAX_MENU, type WaBotMode, type WaMenuItem, type WaNumberDto } from "@catgpt/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useSaveWaSettings } from "@/lib/whatsapp-hooks";

const MODE_HELP: Record<WaBotMode, string> = {
  off: "The bot never replies. Your team answers from the Inbox.",
  menu: "Greets with tap buttons and canned answers. Predictable; free text just shows the menu again.",
  ai: "AI answers from the brand profile and uploaded PDFs, asks qualifying questions and saves lead details.",
  hybrid: "Menu on a new chat, then AI handles anything typed. Best default.",
};
const KIND_HELP: Record<WaMenuItem["kind"], string> = { reply: "Send a text (and optional image)", link: "Send text + a link (brochure, 3D tour, website)", capture: "Start the AI lead questions", human: "Hand over to your team" };

const newId = () => Math.random().toString(36).slice(2, 8);

export function BotSettings({ number }: { number: WaNumberDto }) {
  const save = useSaveWaSettings(number.id);
  const [s, setS] = useState({
    botMode: number.botMode,
    greeting: number.greeting,
    aiInstructions: number.aiInstructions,
    menu: number.menu,
    handoffKeywords: number.handoffKeywords.join(", "),
    handoffMessage: number.handoffMessage,
  });
  const setItem = (i: number, p: Partial<WaMenuItem>) => setS({ ...s, menu: s.menu.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const needsMenu = (s.botMode === "menu" || s.botMode === "hybrid") && s.menu.length === 0;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">How should the bot answer?</h3>
          <Select className="w-auto" value={s.botMode} onChange={(e) => setS({ ...s, botMode: e.target.value as WaBotMode })} aria-label="Bot mode">
            {WA_BOT_MODES.map((m) => <option key={m} value={m}>{m === "ai" ? "AI only" : m === "menu" ? "Menu only" : m === "hybrid" ? "Menu + AI" : "Off (human only)"}</option>)}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{MODE_HELP[s.botMode]} You can change this any time; it applies to the next message.</p>
        <label className="block text-xs font-medium">Greeting</label>
        <Textarea rows={2} placeholder="Hi! Welcome to Vgrand. How can we help you today?" value={s.greeting} onChange={(e) => setS({ ...s, greeting: e.target.value })} />
      </Card>

      {s.botMode !== "off" && s.botMode !== "menu" && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">AI instructions</h3>
          <p className="text-xs text-muted-foreground">It already knows the brand profile and the PDFs in the brand knowledge base (brochures, price sheets). Add rules here.</p>
          <Textarea rows={4} placeholder={"Always push a site visit. Never quote final prices, say the sales team will confirm. Reply in the customer's language."} value={s.aiInstructions} onChange={(e) => setS({ ...s, aiInstructions: e.target.value })} />
        </Card>
      )}

      {s.botMode !== "off" && s.botMode !== "ai" && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Menu ({s.menu.length}/{WA_MAX_MENU})</h3>
            <Button size="sm" variant="outline" disabled={s.menu.length >= WA_MAX_MENU} onClick={() => setS({ ...s, menu: [...s.menu, { id: newId(), title: "", kind: "reply", text: "", url: null, imageUrl: null }] })}>
              <Plus className="size-4" /> Add item
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Up to 3 items show as buttons; 4 to 10 show as a list.</p>
          {needsMenu && <p className="text-xs text-destructive">Add at least one item or the bot has nothing to show.</p>}
          {s.menu.map((m, i) => (
            <div key={m.id} className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2">
                <Input maxLength={24} placeholder="Button text (max 24)" value={m.title} onChange={(e) => setItem(i, { title: e.target.value })} />
                <Select className="w-56" value={m.kind} onChange={(e) => setItem(i, { kind: e.target.value as WaMenuItem["kind"] })} aria-label="Action">
                  {(Object.keys(KIND_HELP) as WaMenuItem["kind"][]).map((k) => <option key={k} value={k}>{KIND_HELP[k]}</option>)}
                </Select>
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setS({ ...s, menu: s.menu.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
              </div>
              {(m.kind === "reply" || m.kind === "link") && <Textarea rows={2} placeholder="What the bot sends" value={m.text} onChange={(e) => setItem(i, { text: e.target.value })} />}
              {m.kind === "link" && <Input placeholder="https://vgrandgroup.com/…" value={m.url ?? ""} onChange={(e) => setItem(i, { url: e.target.value || null })} />}
              {(m.kind === "reply" || m.kind === "link") && <Input placeholder="Image URL (optional)" value={m.imageUrl ?? ""} onChange={(e) => setItem(i, { imageUrl: e.target.value || null })} />}
            </div>
          ))}
        </Card>
      )}

      {s.botMode !== "off" && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">Handing over to your team</h3>
          <p className="text-xs text-muted-foreground">Words like &quot;human&quot;, &quot;agent&quot; and &quot;call me&quot; always hand over. Add your own. Voice notes and photos hand over too, since the bot can&apos;t read them.</p>
          <Input placeholder="site visit, negotiate, loan" value={s.handoffKeywords} onChange={(e) => setS({ ...s, handoffKeywords: e.target.value })} />
          <Input placeholder="Sure, one of our team will message you here shortly." value={s.handoffMessage} onChange={(e) => setS({ ...s, handoffMessage: e.target.value })} />
        </Card>
      )}

      <Button
        disabled={save.isPending || needsMenu || s.menu.some((m) => !m.title.trim())}
        onClick={() =>
          save.mutate(
            { ...s, handoffKeywords: s.handoffKeywords.split(",").map((k) => k.trim()).filter(Boolean) },
            { onSuccess: () => toast.success("Bot settings saved"), onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Could not save") },
          )
        }
      >
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
