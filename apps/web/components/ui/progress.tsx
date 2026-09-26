import { cn } from "@/lib/utils";

/** 0-100 bar; pass `value={null}` for "unknown". */
export function Progress({ value, className }: { value: number | null; className?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(pct)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
