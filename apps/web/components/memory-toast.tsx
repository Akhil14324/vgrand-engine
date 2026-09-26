"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, X } from "lucide-react";
import { useMemories } from "@/lib/hooks";
import { useStudio } from "@/lib/store";

const VISIBLE_MS = 6000;

/**
 * ChatGPT-style "Memory updated" note. Extraction runs in the background after
 * a reply finishes, so the stream can't announce it; instead the memory list is
 * re-checked shortly after each text reply (see lib/sse.ts) and any id we have
 * not seen before means a fact was just saved.
 */
export function MemoryToast() {
  const { data } = useMemories();
  const setMemoryDialogOpen = useStudio((s) => s.setMemoryDialogOpen);
  const known = useRef<Set<string> | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.items.map((m) => m.id));
    // First load only seeds the baseline — existing memories are not "new".
    if (known.current && data.enabled) {
      for (const id of ids) {
        if (!known.current.has(id)) {
          setVisible(true);
          break;
        }
      }
    }
    known.current = ids;
  }, [data]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 animate-fade-in items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm shadow-lg"
    >
      <Brain className="h-4 w-4 text-primary" />
      <span>Memory updated</span>
      <button
        onClick={() => {
          setVisible(false);
          setMemoryDialogOpen(true);
        }}
        className="text-primary underline-offset-2 hover:underline"
      >
        Manage
      </button>
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
