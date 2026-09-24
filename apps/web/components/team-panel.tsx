"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link2, Loader2, LogOut, Send, Sparkles, UserPlus, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TeamMessageDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";

/* --------------------------------- members --------------------------------- */

/** Who is in the workspace, plus invite link / add-by-email for the owner. */
export function MembersPanel({ workspace }: { workspace: WorkspaceDto }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOwner = workspace.role === "owner";
  const key = ["workspace-members", workspace.id];
  const { data: members } = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<{ items: WorkspaceMemberDto[] }>(`/workspaces/${workspace.id}/members`),
    select: (d) => d.items,
  });
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
  };

  const invite = useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>(`/workspaces/${workspace.id}/invite`, { method: "POST" }),
    onSuccess: async ({ url }) => {
      await navigator.clipboard.writeText(url).catch(() => {});
      setNote("Invite link copied. Anyone who opens it and signs in joins this workspace.");
    },
    onError: (e) => setNote(e.message),
  });
  const revoke = useMutation({
    mutationFn: () =>
      apiFetch<void>(`/workspaces/${workspace.id}/invite`, { method: "DELETE" }),
    onSuccess: () => setNote("Invite links revoked - old links no longer work."),
  });
  const add = useMutation({
    mutationFn: (e: string) =>
      apiFetch<unknown>(`/workspaces/${workspace.id}/members`, {
        method: "POST",
        json: { email: e },
      }),
    onSuccess: () => {
      setEmail("");
      setNote("Added.");
      refresh();
    },
    onError: (e) => setNote(e.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/workspaces/${workspace.id}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: refresh,
    onError: (e) => setNote(e.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">People ({members?.length ?? workspace.memberCount})</p>
        {isOwner && (
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => invite.mutate()} disabled={invite.isPending}>
              {invite.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
              Copy invite link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => revoke.mutate()}>
              Revoke links
            </Button>
          </div>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {(members ?? []).map((m) => (
          <li
            key={m.userId}
            className="flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-2 text-xs"
            title={m.email}
          >
            <span>{m.name}</span>
            {m.role === "owner" && <span className="text-[10px] text-primary">owner</span>}
            {m.userId === user?.id && m.role !== "owner" ? (
              <button
                onClick={() => window.confirm("Leave this workspace?") && remove.mutate(m.userId)}
                aria-label="Leave workspace"
                title="Leave workspace"
              >
                <LogOut className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            ) : (
              isOwner &&
              m.role !== "owner" && (
                <button
                  onClick={() => remove.mutate(m.userId)}
                  aria-label={`Remove ${m.name}`}
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              )
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          className="flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (email.trim()) add.mutate(email.trim());
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Add someone by email (they need an account)"
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={add.isPending}>
            <UserPlus /> Add
          </Button>
        </form>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/* -------------------------------- team chat -------------------------------- */

const POLL_MS = 2500;
const POLL_FAST_MS = 1000; // while an AI reply is being written

/** Shared chat: people talk to each other; "@ai ..." brings CatGPT in. */
export function TeamChat({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<TeamMessageDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sinceRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // keep following the newest message

  const merge = useCallback((incoming: TeamMessageDto[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    const newest = incoming.reduce((a, m) => (m.updatedAt > a ? m.updatedAt : a), "");
    if (!sinceRef.current || newest > sinceRef.current) sinceRef.current = newest;
  }, []);

  const pending = messages.some((m) => m.status === "pending");

  useEffect(() => {
    setMessages([]);
    setLoaded(false);
    sinceRef.current = null;
  }, [workspaceId]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const qs = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
          const { items } = await apiFetch<{ items: TeamMessageDto[] }>(
            `/workspaces/${workspaceId}/messages${qs}`,
          );
          if (!stopped) {
            merge(items);
            setLoaded(true);
            setError(null);
          }
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : "Could not load messages");
        }
      }
      timer = setTimeout(tick, pending ? POLL_FAST_MS : POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workspaceId, merge, pending]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: TeamMessageDto; ai: TeamMessageDto | null }>(
        `/workspaces/${workspaceId}/messages`,
        { method: "POST", json: { body } },
      );
      setText("");
      stickRef.current = true;
      merge([res.message, ...(res.ai ? [res.ai] : [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[28rem] flex-col rounded-xl border">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {!loaded && <div className="shimmer h-16 rounded-lg" />}
        {loaded && messages.length === 0 && (
          <p className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            No messages yet. Say hi to your team, or type <b>@ai</b> to ask CatGPT — it can
            read your workspace documents.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.authorId !== null && m.authorId === user?.id;
          const ai = m.role === "ai";
          return (
            <div key={m.id} className={cn("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}>
              <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                {ai && <Sparkles className="h-3 w-3 text-primary" />}
                {mine ? "You" : m.authorName}
                <span className="opacity-60">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              <div
                className={cn(
                  "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[75%]",
                  mine ? "rounded-br-md bg-accent" : "rounded-bl-md border bg-card/60",
                  m.status === "failed" && "border-destructive/50",
                )}
              >
                {m.status === "pending" ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> CatGPT is thinking…
                  </span>
                ) : ai ? (
                  <Markdown>{m.body}</Markdown>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="px-3 pb-1 text-xs text-destructive">{error}</p>}
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          onClick={() => setText((t) => (t.includes("@ai") ? t : `@ai ${t}`))}
          className="mb-1 flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
          title="Ask CatGPT"
        >
          <Sparkles className="h-3.5 w-3.5" /> @ai
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message your team - type @ai to ask CatGPT"
          rows={1}
          maxLength={2000}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button type="submit" size="icon" disabled={!text.trim() || sending} aria-label="Send message" className="mb-0.5">
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </div>
  );
}

