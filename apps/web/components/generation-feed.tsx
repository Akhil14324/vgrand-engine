"use client";

import { useEffect, useMemo, useRef } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useConversation, useGenerations } from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChatTurn } from "./chat-turn";

/** Chat thread: oldest at top, newest at bottom, auto-scrolls like ChatGPT. */
export function GenerationFeed() {
  const { activeConversationId, pendingTurn, clearPendingTurn } = useStudio();
  const { data, isLoading } = useGenerations({
    conversationId: activeConversationId,
  });
  const { data: conversation } = useConversation(activeConversationId);
  const items = useMemo(
    () => [...(data?.items ?? [])].reverse(),
    [data],
  );

  // The optimistic bubble hands over to the real turn once it is in the list.
  const landed = Boolean(
    pendingTurn?.generationId &&
      items.some((g) => g.id === pendingTurn.generationId),
  );
  useEffect(() => {
    if (landed) clearPendingTurn();
  }, [landed, clearPendingTurn]);
  const showPending =
    Boolean(pendingTurn) &&
    pendingTurn?.conversationId === activeConversationId &&
    !landed;

  const endRef = useRef<HTMLDivElement>(null);
  const last = items.at(-1);
  const lastStatus = last?.status;
  const streamedLength = last?.textResponse?.length ?? 0;
  const scrollKey = `${items.length}:${lastStatus}:${activeConversationId}:${showPending}`;
  const lastScrollKey = useRef("");
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const viewport = el.closest("[data-radix-scroll-area-viewport]");
    const gap = viewport
      ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      : 0;
    const structural = scrollKey !== lastScrollKey.current;
    lastScrollKey.current = scrollKey;
    // New turns/chats always scroll; streamed tokens only follow along while
    // the reader is still near the bottom, so scrolling up to read isn't fought.
    if (structural || gap < 240) el.scrollIntoView({ block: "end" });
  }, [scrollKey, streamedLength]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pb-6 md:p-6">
        {conversation && (
          <p className="text-right text-xs text-muted-foreground">
            {conversation.generationCount}{" "}
            {conversation.generationCount === 1 ? "turn" : "turns"}
          </p>
        )}
        {isLoading && !showPending ? (
          <div className="flex flex-col gap-8">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="ml-auto h-12 w-2/3 rounded-2xl bg-muted/50" />
                {/* Text-shaped: most turns are chat replies, not images. */}
                <div className="flex max-w-[75%] flex-col gap-2">
                  <div className="h-3 w-full rounded shimmer" />
                  <div className="h-3 w-11/12 rounded shimmer" />
                  <div className="h-3 w-2/3 rounded shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : isLoading ? null : items.length === 0 && !showPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No messages yet — ask a question or describe an image below.
          </p>
        ) : (
          items.map((g) => <ChatTurn key={g.id} generation={g} />)
        )}
        {/* Optimistic turn — the user's bubble the instant they hit Send,
            before the POST resolves and the real generation lands. */}
        {showPending && <PendingTurnBubble />}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

/** Lightweight stand-in for a turn whose POST is still in flight. */
export function PendingTurnBubble() {
  const { pendingTurn } = useStudio();
  if (!pendingTurn) return null;
  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 sm:max-w-[70%]">
          {pendingTurn.refImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingTurn.refImages.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={`reference ${i + 1}`}
                  className="h-10 w-10 rounded-md object-cover"
                />
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {pendingTurn.prompt}
          </p>
          {pendingTurn.docs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
              {pendingTurn.docs.map((d) => (
                <Badge key={d.id} variant="outline" className="gap-1 text-[10px]">
                  <FileText className="h-2.5 w-2.5" />
                  {d.filename}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-xl border px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
      </div>
    </div>
  );
}
