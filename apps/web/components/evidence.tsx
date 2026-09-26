"use client";

import { EVIDENCE_TEXT, type EvidenceItem, type EvidenceLabel } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<EvidenceLabel, "default" | "secondary" | "muted" | "outline" | "destructive"> = {
  observed: "default",
  entered: "secondary",
  calculated: "secondary",
  estimated: "outline",
  hypothesis: "outline",
  unknown: "muted",
};

/** Says where a statement comes from. Hover for what that label means. */
export function EvidenceBadge({ label }: { label: EvidenceLabel }) {
  return (
    <Badge variant={VARIANT[label]} title={EVIDENCE_TEXT[label].hint} className="shrink-0 whitespace-nowrap">
      {EVIDENCE_TEXT[label].label}
    </Badge>
  );
}

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
          <EvidenceBadge label={e.label} />
          <span className="min-w-0 flex-1 text-muted-foreground">{e.text}</span>
        </li>
      ))}
    </ul>
  );
}
