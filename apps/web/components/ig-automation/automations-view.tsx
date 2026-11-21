"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Pencil, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import type { IgAccountDto, IgRuleDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { RuleEditor } from "@/components/ig-automation/rule-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useConnectSocial } from "@/lib/hooks";
import {
  useDeleteIgRule,
  useIgAccounts,
  useIgEvents,
  useIgRules,
  useIgStatus,
  usePatchIgRule,
  useRetryIgEvent,
  useSubscribeIgPage,
  useTestIgRules,
} from "@/lib/ig-automation-hooks";
import { cn } from "@/lib/utils";

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never";

const errText = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

export function AutomationsView() {
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
            <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">Instagram Automations</h1>
            <p className="truncate text-xs text-muted-foreground">When people comment or DM your keywords, reply publicly and send them a DM</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:px-4 sm:py-6">
            <Automations />
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

function ConnectButton({ label = "Connect Instagram", variant = "default" as "default" | "outline" }) {
  const connect = useConnectSocial();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={connect.isPending}
      onClick={() => connect.mutate({ platform: "instagram", workspaceId: null }, { onError: (e) => toast.error(errText(e, "Could not start the connection")) })}
    >
      {label}
    </Button>
  );
}

function Automations() {
  const accounts = useIgAccounts();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && accounts.data?.length) setSelected(accounts.data[0]!.id);
  }, [accounts.data, selected]);

  if (accounts.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!accounts.data?.length) {
    return (
      <Card className="mx-auto max-w-lg space-y-3 p-6 text-center">
        <h2 className="text-lg font-semibold">Connect an Instagram professional account</h2>
        <p className="text-sm text-muted-foreground">
          Automations run on Instagram business or creator accounts linked to a Facebook Page. Connect it with Facebook to start.
        </p>
        <ConnectButton />
      </Card>
    );
  }
  const account = accounts.data.find((a) => a.id === selected) ?? accounts.data[0]!;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {accounts.data.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a.id)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
              a.id === account.id ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {a.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
            )}
            {a.handle ?? a.displayName ?? "Instagram"}
            {a.activeRules > 0 && <Badge variant="secondary">{a.activeRules} on</Badge>}
          </button>
        ))}
        <ConnectButton label="Connect another" variant="outline" />
      </div>
      <div key={account.id} className="space-y-4">
        <Setup account={account} />
        <Rules account={account} />
        <TestBox accountId={account.id} />
        <Activity accountId={account.id} />
      </div>
    </>
  );
}

/* ---------------------------------- setup ---------------------------------- */

function Check({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-label="done" />
      ) : ok === false ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="missing" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="unknown" />
      )}
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function Setup({ account }: { account: IgAccountDto }) {
  const status = useIgStatus(account.id);
  const subscribe = useSubscribeIgPage();
  const s = status.data;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Setup</h2>
        <div className="flex items-center gap-2">
          {s && (s.ready ? <Badge variant="secondary">Ready: automations will run</Badge> : <Badge variant="destructive">Not ready yet</Badge>)}
          <Button size="sm" variant="ghost" onClick={() => status.refetch()} disabled={status.isFetching}>
            <RefreshCw /> Check again
          </Button>
        </div>
      </div>
      {account.status !== "active" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" /> This account&apos;s connection expired or was revoked. Automations are paused for it.
          <ConnectButton label="Reconnect" />
        </div>
      )}
      {status.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : status.error ? (
        <p className="text-sm text-destructive">{errText(status.error, "Could not check this account")}</p>
      ) : s ? (
        <ul className="space-y-2 text-sm">
          <Check ok={s.webhook.verifyTokenSet && s.webhook.appSecretSet}>
            <div>Webhook (Meta App Dashboard → Webhooks → Instagram): subscribe to <code>comments</code>, <code>live_comments</code> and <code>messages</code> with</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.webhook.callbackUrl}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(s.webhook.callbackUrl);
                  toast.success("Callback URL copied");
                }}
              >
                <Copy /> Copy
              </Button>
            </div>
            {!s.webhook.verifyTokenSet && <div className="text-xs text-destructive">Set META_WEBHOOK_VERIFY_TOKEN on the server and type the same value as the Verify Token in Meta.</div>}
            {!s.webhook.appSecretSet && <div className="text-xs text-destructive">META_APP_SECRET is not set: deliveries can&apos;t be verified and are refused.</div>}
          </Check>
          <Check ok={s.permissions.checked ? s.permissions.valid === true && s.permissions.missing.length === 0 : null}>
            {s.permissions.error ? (
              <span>Couldn&apos;t read permissions: {s.permissions.error}</span>
            ) : s.permissions.missing.length ? (
              <div className="space-y-1">
                <div>
                  Missing permissions: {s.permissions.missing.map((p) => <code key={p} className="mr-1 rounded bg-muted px-1 text-xs">{p}</code>)}
                </div>
                <div className="text-xs text-muted-foreground">After Meta grants them (Advanced Access), reconnect so the token includes them.</div>
                <ConnectButton label="Reconnect" variant="outline" />
              </div>
            ) : (
              <span>All permissions granted</span>
            )}
          </Check>
          <Check ok={s.subscription.checked ? s.subscription.subscribed : null}>
            {s.subscription.error ? (
              <span>Page subscription unknown: {s.subscription.error}</span>
            ) : s.subscription.subscribed ? (
              <span>Facebook Page subscribed to this app{s.subscription.fields.length ? ` (${s.subscription.fields.join(", ")})` : ""}</span>
            ) : (
              <span>Facebook Page not subscribed to this app.</span>
            )}{" "}
            {!s.subscription.subscribed && (
              <Button
                size="sm"
                variant="outline"
                disabled={subscribe.isPending}
                onClick={async () => {
                  try {
                    await subscribe.mutateAsync(account.id);
                    toast.success("Page subscribed");
                    void status.refetch();
                  } catch (e) {
                    toast.error(errText(e, "Subscribe failed"));
                  }
                }}
              >
                Subscribe page
              </Button>
            )}
          </Check>
          <Check ok={s.lastEventAt ? true : null}>
            Last comment or message received: {when(s.lastEventAt)}
            {!s.lastEventAt && <span className="text-xs text-muted-foreground"> (comment on one of your posts to test once everything above is green)</span>}
          </Check>
        </ul>
      ) : null}
    </Card>
  );
}

/* ---------------------------------- rules ---------------------------------- */

function Rules({ account }: { account: IgAccountDto }) {
  const rules = useIgRules(account.id);
  const patch = usePatchIgRule();
  const del = useDeleteIgRule();
  const [editing, setEditing] = useState<IgRuleDto | "new" | null>(null);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Rules</h2>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> New rule
        </Button>
      </div>
      {rules.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !rules.data?.length ? (
        <p className="text-sm text-muted-foreground">No rules yet. Example: comment &quot;guide&quot; on any reel → reply &quot;Sent it to your DMs!&quot; → DM the guide link.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {rules.data.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
              <Switch
                checked={r.active}
                aria-label={`${r.active ? "Pause" : "Activate"} ${r.name}`}
                onCheckedChange={(v) => patch.mutate({ id: r.id, patch: { active: v } }, { onError: (e) => toast.error(errText(e, "Could not update")) })}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <Badge variant="outline">{r.trigger === "comment" ? "Comment" : "DM"}</Badge>
                  {r.trigger === "comment" && <Badge variant="muted">{r.mediaScope === "all" ? "all posts" : `${r.mediaIds.length} post(s)`}</Badge>}
                  {r.oncePerUser && <Badge variant="muted">once per person</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.matchMode === "any" ? "Any text" : `${r.matchMode === "exact" ? "Exactly" : "Contains"}: ${r.keywords.join(", ")}`}
                  {r.publicReplies.length ? ` · public: "${r.publicReplies[0]}"${r.publicReplies.length > 1 ? ` +${r.publicReplies.length - 1}` : ""}` : ""}
                  {r.dmText ? ` · DM: "${r.dmText.slice(0, 60)}${r.dmText.length > 60 ? "..." : ""}"` : ""}
                  {r.dmButtonUrl ? " + link button" : ""}
                </div>
                {r.problems.length > 0 && <div className="text-xs text-destructive">{r.problems.join(". ")}</div>}
                <div className="text-xs tabular-nums text-muted-foreground">
                  {r.stats.triggered} triggered · {r.stats.publicReplies} public replies · {r.stats.dms} DMs sent
                  {r.stats.failed ? <span className="text-destructive"> · {r.stats.failed} failed</span> : null}
                  {r.stats.skipped ? ` · ${r.stats.skipped} skipped` : ""}
                </div>
              </div>
              <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${r.name}`}
                onClick={() => {
                  if (window.confirm(`Delete "${r.name}"? Its activity history is kept.`)) del.mutate(r.id, { onError: (e) => toast.error(errText(e, "Could not delete")) });
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
      {editing && <RuleEditor accountId={account.id} rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/* ---------------------------------- test ----------------------------------- */

function TestBox({ accountId }: { accountId: string }) {
  const test = useTestIgRules(accountId);
  const [trigger, setTrigger] = useState<"comment" | "dm">("comment");
  const [text, setText] = useState("");
  const r = test.data;
  return (
    <Card className="space-y-2 p-4 text-sm">
      <h2 className="font-semibold">Test a comment</h2>
      <p className="text-xs text-muted-foreground">Shows which rule would fire and exactly what would be sent. Nothing is posted.</p>
      <div className="flex flex-wrap gap-2">
        <Select className="w-36" value={trigger} onChange={(e) => setTrigger(e.target.value as "comment" | "dm")} aria-label="Type">
          <option value="comment">Comment</option>
          <option value="dm">DM</option>
        </Select>
        <Input className="min-w-[200px] flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. can I get the guide?" />
        <Button
          size="sm"
          disabled={!text.trim() || test.isPending}
          onClick={() => test.mutate({ trigger, text, mediaId: null, username: "example_user" }, { onError: (e) => toast.error(errText(e, "Test failed")) })}
        >
          Test
        </Button>
      </div>
      {r && (
        <div className="rounded-md border p-2 text-sm">
          {!r.matched ? (
            <span className="text-muted-foreground">No active rule matches. Nothing would be sent.</span>
          ) : (
            <div className="space-y-1">
              <div>
                Rule: <span className="font-medium">{r.ruleName}</span>
              </div>
              <div>Public reply: {r.publicReply ? `"${r.publicReply}"` : <span className="text-muted-foreground">none{r.publicReplyNote ? ` (${r.publicReplyNote})` : ""}</span>}</div>
              <div>
                DM: {r.dm ? `"${r.dm.text}"` : <span className="text-muted-foreground">none</span>}
                {r.dm?.buttonUrl && (
                  <span className="text-muted-foreground">
                    {" "}
                    + button &quot;{r.dm.buttonTitle}&quot; → {r.dm.buttonUrl}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">Post-specific rules only fire for their posts, so this test (no post) checks all-posts rules.</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* --------------------------------- activity -------------------------------- */

const STATUS_STYLE: Record<string, "secondary" | "destructive" | "muted" | "default" | "outline"> = {
  done: "secondary",
  partial: "default",
  failed: "destructive",
  pending: "outline",
  no_match: "muted",
  skipped: "muted",
};

const SKIP_LABEL: Record<string, string> = {
  own_account: "your own comment",
  empty_text: "no text",
  already_replied_to_user: "already replied to this person",
  account_not_active: "account needs reconnecting",
};

function Activity({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState("");
  const events = useIgEvents(accountId, status);
  const retry = useRetryIgEvent();
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Activity</h2>
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter">
          <option value="">Everything</option>
          <option value="done">Done</option>
          <option value="partial">Partly done</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
          <option value="no_match">No rule matched</option>
          <option value="pending">Processing</option>
        </Select>
      </div>
      {events.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !events.data?.length ? (
        <p className="text-sm text-muted-foreground">Nothing received yet. Comments and DMs show up here as Meta delivers them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="pr-3">From</th>
                <th className="pr-3">Text</th>
                <th className="pr-3">Rule</th>
                <th className="pr-3">Public reply</th>
                <th className="pr-3">DM</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">
                    {when(e.occurredAt)}
                    <div>{e.kind === "comment" ? "comment" : "DM"}</div>
                  </td>
                  <td className="pr-3">{e.fromUsername ? `@${e.fromUsername}` : (e.fromId ?? "-")}</td>
                  <td className="max-w-[220px] pr-3">
                    <div className="line-clamp-2">{e.text}</div>
                  </td>
                  <td className="pr-3 text-xs">{e.ruleName ?? "-"}</td>
                  <td className="pr-3 text-xs">{e.publicReplyStatus ?? "-"}</td>
                  <td className="pr-3 text-xs">{e.dmStatus ?? "-"}</td>
                  <td className="text-xs">
                    <Badge variant={STATUS_STYLE[e.status] ?? "muted"}>{e.status.replace("_", " ")}</Badge>
                    {e.skipReason && e.skipReason !== "live" && <div className="mt-1 text-muted-foreground">{SKIP_LABEL[e.skipReason] ?? e.skipReason}</div>}
                    {e.error && <div className="mt-1 text-destructive">{e.error}</div>}
                    {(e.status === "failed" || e.status === "partial") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-7 px-2"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(e.id, { onSuccess: () => toast.success("Retrying"), onError: (err) => toast.error(errText(err, "Retry failed")) })}
                      >
                        <RefreshCw /> Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
