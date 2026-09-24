"use client";

import { useImageUsage } from "@/lib/hooks";

/** Today's image quota under the account name — chat is unlimited. */
export function ImageUsage() {
  const { data } = useImageUsage();
  return (
    <p className="truncate text-[11px] text-muted-foreground">
      {data
        ? `${data.remaining} of ${data.limit} images left today`
        : "Unlimited chat"}
    </p>
  );
}
