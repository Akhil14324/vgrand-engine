"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (kind, message) => set((s) => ({ items: [...s.items.slice(-3), { id: nextId++, kind, message }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Fire from anywhere (no hook needed): toast.success("Saved"). */
export const toast = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => useToastStore.getState().push("error", m),
  info: (m: string) => useToastStore.getState().push("info", m),
};

function ToastRow({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), item.kind === "error" ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [item.id, item.kind, dismiss]);
  const Icon = item.kind === "error" ? CircleAlert : CheckCircle2;
  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg",
        item.kind === "error" && "border-destructive/40",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", item.kind === "error" ? "text-destructive" : "text-primary")} />
      <span className="flex-1 break-words">{item.message}</span>
      <button onClick={() => dismiss(item.id)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Mounted once in Providers. */
export function Toaster() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </div>
  );
}
