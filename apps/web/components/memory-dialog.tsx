"use client";

import { Loader2, Trash2 } from "lucide-react";
import {
  useClearMemories,
  useDeleteMemory,
  useMemories,
  useSetMemoryEnabled,
} from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** ChatGPT-style "Manage memory": an on/off switch and a plain list of facts. */
export function MemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useMemories();
  const setEnabled = useSetMemoryEnabled();
  const clear = useClearMemories();
  const del = useDeleteMemory();
  const items = data?.items ?? [];
  const enabled = data?.enabled ?? true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Memory</DialogTitle>
          <DialogDescription>
            Useful things CatGPT picks up about you in chats, like your name,
            role or preferences, so replies feel more personal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Reference saved memories</p>
            <p className="text-xs text-muted-foreground">
              When off, nothing new is saved or used in replies.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Memory on or off"
            disabled={setEnabled.isPending}
            onClick={() => setEnabled.mutate(!enabled)}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60",
              enabled ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                enabled && "translate-x-4",
              )}
            />
          </button>
        </div>

        <div className="mt-3 max-h-[45vh] overflow-y-auto rounded-lg border">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing saved yet. Memories appear here as you chat.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-start gap-3 px-3 py-2.5"
                >
                  <p className="min-w-0 flex-1 break-words text-sm">
                    {m.content}
                  </p>
                  <button
                    onClick={() => del.mutate(m.id)}
                    aria-label="Delete memory"
                    className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={items.length === 0 || clear.isPending}
            onClick={() => {
              if (window.confirm("Clear all memories? This can't be undone.")) {
                clear.mutate();
              }
            }}
          >
            Clear all
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
