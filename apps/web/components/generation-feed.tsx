"use client";

import { useEffect, useMemo, useRef } from "react";
import { useConversation, useGenerations } from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatTurn } from "./chat-turn";

/** Chat thread: oldest at top, newest at bottom, auto-scrolls like ChatGPT. */
export function GenerationFeed() {
  const { activeConversationId } = useStudio();
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
            {conversation.generationCount === 1 ? "image" : "images"}
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
            No generations in this chat yet — describe the next one below.
          </p>
        ) : (
          items.map((g) => <ChatTurn key={g.id} generation={g} />)
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
