"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { IG_MAX_OPTIONS, type IgOption, type IgRuleDto, type IgRuleInput } from "@catgpt/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useIgMedia, useSaveIgRule } from "@/lib/ig-automation-hooks";
import { cn } from "@/lib/utils";

const lines = (v: string) =>
  v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const csv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function RuleEditor({ accountId, rule, onClose }: { accountId: string; rule: IgRuleDto | null; onClose: () => void }) {
  const save = useSaveIgRule(accountId);
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<IgRuleInput["trigger"]>(rule?.trigger ?? "comment");
  const [matchMode, setMatchMode] = useState<IgRuleInput["matchMode"]>(rule?.matchMode ?? "keywords");
  const [keywords, setKeywords] = useState((rule?.keywords ?? []).join(", "));
  const [mediaScope, setMediaScope] = useState<IgRuleInput["mediaScope"]>(rule?.mediaScope ?? "all");
  const [mediaIds, setMediaIds] = useState<string[]>(rule?.mediaIds ?? []);
  const [publicReplies, setPublicReplies] = useState((rule?.publicReplies ?? []).join("\n"));
  const [dmText, setDmText] = useState(rule?.dmText ?? "");
  const [buttonTitle, setButtonTitle] = useState(rule?.dmButtonTitle ?? "");
  const [buttonUrl, setButtonUrl] = useState(rule?.dmButtonUrl ?? "");
  const [options, setOptions] = useState<IgOption[]>(rule?.dmOptions ?? []);
  const [oncePerUser, setOncePerUser] = useState(rule?.oncePerUser ?? true);
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [active, setActive] = useState(rule?.active ?? true);
  const media = useIgMedia(accountId, trigger === "comment" && mediaScope === "selected");
  const dmMax = buttonUrl.trim() || options.length ? 640 : 1000;
  const setOption = (i: number, patch: Partial<IgOption>) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const submit = async () => {
    const input: IgRuleInput = {
      name: name.trim() || "Untitled rule",
      active,
      trigger,
      matchMode,
      keywords: matchMode === "any" ? [] : csv(keywords),
      mediaScope: trigger === "dm" ? "all" : mediaScope,
      mediaIds: trigger === "comment" && mediaScope === "selected" ? mediaIds : [],
      publicReplies: trigger === "comment" ? lines(publicReplies) : [],
      dmText: dmText.trim() || null,
      dmButtonTitle: buttonTitle.trim() || null,
      dmButtonUrl: buttonUrl.trim() || null,
      dmOptions: options.filter((o) => o.title.trim() && o.url.trim()),
      oncePerUser,
      priority: Number(priority) || 100,
    };
    try {
      await save.mutateAsync({ id: rule?.id ?? null, input });
      toast.success("Rule saved");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not save the rule");
    }
  };

  const toggleMedia = (id: string) => setMediaIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>When a comment (or DM) matches, reply publicly and/or send a DM. Use {"{username}"} to mention the person.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <Field label="Rule name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Free guide funnel" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="When someone">
              <Select value={trigger} onChange={(e) => setTrigger(e.target.value as IgRuleInput["trigger"])}>
                <option value="comment">comments on a post or reel</option>
                <option value="dm">sends a DM</option>
              </Select>
            </Field>
            <Field label="Match">
              <Select value={matchMode} onChange={(e) => setMatchMode(e.target.value as IgRuleInput["matchMode"])}>
                <option value="keywords">contains a keyword</option>
                <option value="exact">is exactly a keyword</option>
                <option value="any">anything (every {trigger === "dm" ? "message" : "comment"})</option>
              </Select>
            </Field>
          </div>
          {matchMode !== "any" && (
            <Field label="Keywords (comma separated; case and accents don't matter, whole words only)">
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="guide, link, send" />
            </Field>
          )}
          {trigger === "comment" && (
            <Field label="Posts">
              <Select value={mediaScope} onChange={(e) => setMediaScope(e.target.value as IgRuleInput["mediaScope"])}>
                <option value="all">All posts and reels (including future ones)</option>
                <option value="selected">Only the posts I pick</option>
              </Select>
              {mediaScope === "selected" && (
                <div className="mt-2">
                  {media.isLoading ? (
                    <p className="text-xs text-muted-foreground">Loading your recent posts...</p>
                  ) : media.error ? (
                    <p className="text-xs text-destructive">
                      Couldn&apos;t load posts from Instagram ({media.error instanceof ApiRequestError ? media.error.message : "error"}). Selected post ids are kept.
                    </p>
                  ) : (
                    <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                      {media.data?.map((m) => {
                        const on = mediaIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMedia(m.id)}
                            title={m.caption ?? m.id}
                            className={cn("relative aspect-square overflow-hidden rounded border bg-muted text-[10px]", on && "ring-2 ring-primary")}
                          >
                            {m.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="p-1">{m.productType ?? m.mediaType}</span>
                            )}
                            {on && (
                              <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{mediaIds.length} selected</p>
                </div>
              )}
            </Field>
          )}
          {trigger === "comment" && (
            <Field label="Public reply under the comment (one per line; one is picked at random so replies don't look copy-pasted). Leave empty for none.">
              <Textarea rows={3} value={publicReplies} onChange={(e) => setPublicReplies(e.target.value)} placeholder={"Sent it to your DMs {username}!\nCheck your inbox {username}"} />
            </Field>
          )}
          <Field label={`${trigger === "comment" ? "Private DM to the commenter" : "DM reply"} (${dmText.length}/${dmMax})`}>
            <Textarea rows={4} value={dmText} onChange={(e) => setDmText(e.target.value)} placeholder="Here's the free guide you asked for!" />
          </Field>
          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Options the person can tap (optional)</div>
                <p className="text-xs text-muted-foreground">
                  Sent as buttons under the DM, e.g. Floor plan, Brochure, 3D walkthrough. When they tap one, they get that file or link. Up to {IG_MAX_OPTIONS}.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={options.length >= IG_MAX_OPTIONS}
                onClick={() => setOptions((os) => [...os, { id: "", title: "", kind: "image", url: "", text: null }])}
              >
                <Plus className="h-4 w-4" /> Add option
              </Button>
            </div>
            {options.map((o, i) => (
              <div key={o.id || i} className="grid gap-2 rounded-md bg-muted/40 p-2">
                <div className="grid grid-cols-[1fr_9rem_auto] gap-2">
                  <Input value={o.title} maxLength={20} placeholder="Button name, e.g. Floor plan" onChange={(e) => setOption(i, { title: e.target.value })} />
                  <Select value={o.kind} onChange={(e) => setOption(i, { kind: e.target.value as IgOption["kind"] })}>
                    <option value="image">Image</option>
                    <option value="video">Video file</option>
                    <option value="link">Link (PDF, 3D tour)</option>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove option" onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input value={o.url} placeholder="https:// link to the file or page" onChange={(e) => setOption(i, { url: e.target.value })} />
                <Input value={o.text ?? ""} maxLength={600} placeholder="Message sent with it (optional)" onChange={(e) => setOption(i, { text: e.target.value || null })} />
              </div>
            ))}
            {options.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Image and Video send the file itself in the chat. Instagram can&apos;t send PDFs, so for a brochure or a hosted 3D walkthrough use Link: the person gets an Open button. If you also fill in the link below, it is added to the DM text (tappable) and the options stay as buttons under it.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Link button title (optional, max 20)">
              <Input value={buttonTitle} onChange={(e) => setButtonTitle(e.target.value)} placeholder="Open guide" maxLength={20} />
            </Field>
            <Field label="Link button URL (https)">
              <Input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://..." />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <Switch checked={oncePerUser} onCheckedChange={setOncePerUser} /> Reply to each person only once
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} /> Active
            </label>
            <label className="flex items-center gap-2">
              Priority
              <Input className="h-8 w-20" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
              <span className="text-xs text-muted-foreground">lower runs first</span>
            </label>
          </div>
          {trigger === "comment" && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              Instagram rules: the DM is a one-time &quot;private reply&quot; and must go within 7 days of the comment. More DMs are only possible after the
              person replies (within 24 h). Public replies only work on top-level comments, not on replies or live comments.
            </p>
          )}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save rule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
