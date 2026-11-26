"use client";

import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { waTemplateInputSchema, type WaButton, type WaNumberDto, type WaTemplateDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useCreateWaTemplate, useDeleteWaTemplate, useSyncWaTemplates, useWaTemplates } from "@/lib/whatsapp-hooks";

const errText = (e: unknown, fb: string) => (e instanceof ApiRequestError ? e.message : fb);
const placeholders = (body: string) => new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;

export const statusBadge = (s: string) => (s === "approved" ? "secondary" : s === "rejected" || s === "paused" ? "destructive" : "muted");

export function TemplatesTab({ number }: { number: WaNumberDto }) {
  const list = useWaTemplates(number.id);
  const sync = useSyncWaTemplates(number.id);
  const del = useDeleteWaTemplate();
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Messages sent outside a customer&apos;s 24-hour window must use a template Meta has approved (usually minutes to a day). Marketing templates are charged per message by Meta.
        </p>
        <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(undefined, { onSuccess: () => toast.success("Statuses refreshed"), onError: (e) => toast.error(errText(e, "Could not refresh")) })}>
          <RefreshCw className="size-4" /> Check approval
        </Button>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> New template</Button>
      </div>
      {creating && <TemplateForm number={number} onClose={() => setCreating(false)} />}
      {list.data?.length === 0 && !creating && <Card className="p-4 text-sm text-muted-foreground">No templates yet. Create one for a new launch, an offer or a construction update.</Card>}
      {list.data?.map((t) => <TemplateCard key={t.id} t={t} onDelete={() => window.confirm(`Remove ${t.name} from CatGPT?`) && del.mutate(t.id, { onError: (e) => toast.error(errText(e, "Could not remove")) })} />)}
    </div>
  );
}

function TemplateCard({ t, onDelete }: { t: WaTemplateDto; onDelete: () => void }) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{t.name}</b>
        <Badge variant={statusBadge(t.metaStatus)}>{t.metaStatus}</Badge>
        <Badge variant="muted">{t.category.toLowerCase()} · {t.language}</Badge>
        <Button size="icon" variant="ghost" className="ml-auto" aria-label="Remove" onClick={onDelete}><Trash2 className="size-4" /></Button>
      </div>
      {t.headerUrl && <img src={t.headerUrl} alt="" className="max-h-32 rounded" />}
      <p className="whitespace-pre-wrap text-sm">{t.body}</p>
      {t.buttons.length > 0 && <div className="flex flex-wrap gap-1">{t.buttons.map((b, i) => <Badge key={i} variant="outline">{b.text}</Badge>)}</div>}
      {t.rejectReason && <p className="text-xs text-destructive">Meta: {t.rejectReason}</p>}
    </Card>
  );
}

function TemplateForm({ number, onClose }: { number: WaNumberDto; onClose: () => void }) {
  const create = useCreateWaTemplate(number.id);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [language, setLanguage] = useState("en");
  const [headerUrl, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [vars, setVars] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [buttons, setButtons] = useState<WaButton[]>([]);
  const n = placeholders(body);
  const v = (i: number) => vars[i] ?? "";
  const ex = (i: number) => examples[i] ?? "";
  const setAt = (arr: string[], i: number, val: string) => Array.from({ length: n }, (_, k) => (k === i ? val : (arr[k] ?? "")));

  const submit = () => {
    const parsed = waTemplateInputSchema.safeParse({
      name, category, language, headerUrl: headerUrl.trim() || null, body,
      variables: Array.from({ length: n }, (_, i) => v(i).trim()), examples: Array.from({ length: n }, (_, i) => ex(i).trim()), buttons,
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check the form");
    if (parsed.data.variables.some((x) => !x) || parsed.data.examples.some((x) => !x)) return toast.error("Name and give an example for every {{n}} placeholder");
    create.mutate(parsed.data, { onSuccess: () => { toast.success("Submitted to Meta for review"); onClose(); }, onError: (e) => toast.error(errText(e, "Could not create")) });
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-56" placeholder="template_name" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
        <Select className="w-auto" value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")} aria-label="Category">
          <option value="MARKETING">Marketing (offers, launches)</option>
          <option value="UTILITY">Utility (updates, reminders)</option>
        </Select>
        <Input className="w-24" placeholder="en" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language code" />
      </div>
      <Input placeholder="Header image URL (public JPG/PNG, optional)" value={headerUrl} onChange={(e) => setHeader(e.target.value)} />
      <Textarea rows={5} placeholder={"Hi {{1}}, our new project {{2}} is now open for booking. Reply STOP to opt out."} value={body} onChange={(e) => setBody(e.target.value)} />
      <p className="text-xs text-muted-foreground">Use {"{{1}}"}, {"{{2}}"}… for the parts that change per person. Don&apos;t start or end with a placeholder. Marketing templates should include how to opt out.</p>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <code className="w-12 text-xs">{`{{${i + 1}}}`}</code>
          <Input placeholder="Name (e.g. name, project)" value={v(i)} onChange={(e) => setVars(setAt(vars, i, e.target.value))} />
          <Input placeholder="Example value for Meta" value={ex(i)} onChange={(e) => setExamples(setAt(examples, i, e.target.value))} />
        </div>
      ))}
      <div className="space-y-2">
        {buttons.map((b, i) => (
          <div key={i} className="flex gap-2">
            <Select className="w-32" value={b.type} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? ((e.target.value === "url" ? { type: "url", text: x.text, url: "" } : e.target.value === "phone" ? { type: "phone", text: x.text, phone: "" } : { type: "quick_reply", text: x.text }) as WaButton) : x)))} aria-label="Button type">
              <option value="url">Link</option><option value="phone">Call</option><option value="quick_reply">Quick reply</option>
            </Select>
            <Input placeholder="Button text" maxLength={25} value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            {b.type === "url" && <Input placeholder="https://vgrandgroup.com/…" value={b.url} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? ({ ...x, url: e.target.value } as WaButton) : x)))} />}
            {b.type === "phone" && <Input placeholder="+919876543210" value={b.phone} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? ({ ...x, phone: e.target.value } as WaButton) : x)))} />}
            <Button size="icon" variant="ghost" aria-label="Remove button" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        {buttons.length < 3 && <Button size="sm" variant="outline" onClick={() => setButtons([...buttons, { type: "url", text: "", url: "" }])}><Plus className="size-4" /> Button</Button>}
      </div>
      <div className="flex gap-2">
        <Button disabled={create.isPending || !name || !body} onClick={submit}>{create.isPending ? "Sending to Meta…" : "Submit for approval"}</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}
