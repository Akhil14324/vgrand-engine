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
  const { activeConversationId, pendingTurn } = useStudio();
  const { data, isLoading } = useGenerations({
    conversationId: activeConversationId,
  });
  const { data: conversation } = useConversation(activeConversationId);
  const items = useMemo(
    () => [...(data?.items ?? [])].reverse(),
    [data],
  );

  const endRef = useRef<HTMLDivElement>(null);
  const lastStatus = items.at(-1)?.status;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, lastStatus, activeConversationId]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pb-6 md:p-6">
        {conversation && (
          <p className="text-right text-xs text-muted-foreground">
            {conversation.generationCount}{" "}
            {conversation.generationCount === 1 ? "turn" : "turns"}
          </p>
        )}
        {isLoading ? (
          <div className="flex flex-col gap-8">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="ml-auto h-16 w-2/3 rounded-2xl bg-muted/50" />
                <div className="aspect-square w-full max-w-md rounded-xl border shimmer" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No messages yet — ask a question or describe an image below.
          </p>
        ) : (
          items.map((g) => <ChatTurn key={g.id} generation={g} />)
        )}
        {/* Optimistic turn — the user's bubble the instant they hit Send,
            before the POST resolves and the real generation lands. */}
        {pendingTurn &&
          pendingTurn.conversationId === activeConversationId && (
            <PendingTurnBubble />
          )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

/** Lightweight stand-in for a turn whose POST is still in flight. */
function PendingTurnBubble() {
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
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queued…
      </div>
    </div>
  );
}
