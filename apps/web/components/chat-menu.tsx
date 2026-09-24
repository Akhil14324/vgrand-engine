"use client";

import { useEffect, useState } from "react";
import { FileDown, FileText, Link2, Link2Off, Loader2, Share2 } from "lucide-react";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { saveBlob } from "@/lib/image-tools";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "chat";

/** Share the whole chat as a read-only link, or export it as Markdown / PDF. */
export function ChatMenu({
  conversationId,
  title,
}: {
  conversationId: string;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Share and export" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Share2 />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Share</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                const { url } = await apiFetch<{ url: string }>(
                  `/share/conversation/${conversationId}`,
                  { method: "POST" },
                );
                await navigator.clipboard.writeText(url);
                return "Link copied - anyone with it can read this chat.";
              })
            }
          >
            <Link2 className="mr-2 h-4 w-4" /> Copy share link
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                await apiFetch<void>(`/share/conversation/${conversationId}`, {
                  method: "DELETE",
                });
                return "Sharing stopped - old links no longer work.";
              })
            }
          >
            <Link2Off className="mr-2 h-4 w-4" /> Stop sharing
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Export</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                saveBlob(
                  await apiFetchBlob(`/conversations/${conversationId}/export`),
                  `${slug(title)}.md`,
                );
              })
            }
          >
            <FileText className="mr-2 h-4 w-4" /> Markdown (.md)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                const { url } = await apiFetch<{ url: string }>(
                  `/conversations/${conversationId}/pdf`,
                  { method: "POST" },
                );
                window.open(url, "_blank", "noopener,noreferrer");
              })
            }
          >
            <FileDown className="mr-2 h-4 w-4" /> PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {note && (
        <p className="absolute right-0 top-full z-40 mt-1 w-64 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
          {note}
        </p>
      )}
    </div>
  );
}
