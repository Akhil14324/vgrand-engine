"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { IgRuleDto, IgRuleInput } from "@catgpt/types";
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
  const [oncePerUser, setOncePerUser] = useState(rule?.oncePerUser ?? true);
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [active, setActive] = useState(rule?.active ?? true);
  const media = useIgMedia(accountId, trigger === "comment" && mediaScope === "selected");
  const dmMax = buttonUrl.trim() ? 640 : 1000;

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
