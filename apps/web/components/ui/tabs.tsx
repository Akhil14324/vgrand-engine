"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
}
const Ctx = React.createContext<TabsCtx | null>(null);
const useTabs = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("Tabs parts must be used inside <Tabs>");
  return c;
};

/** Controlled (`value`) or uncontrolled (`defaultValue`) tab set. */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = value ?? inner;
  const setValue = (v: string) => {
    if (value === undefined) setInner(v);
    onValueChange?.(v);
  };
  return (
    <Ctx.Provider value={{ value: current, setValue }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current, setValue } = useTabs();
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => setValue(value)}
      className={cn(
        "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Renders only while its tab is active. */
export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current } = useTabs();
  if (current !== value) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}
