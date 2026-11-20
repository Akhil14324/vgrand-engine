"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import type { ShortsVideoDto } from "@catgpt/types";
import { ShortsShell, fmtWhen } from "@/components/shorts/shorts-shell";
import { VideoDetailDialog } from "@/components/shorts/video-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useManualQueue, useMarkPosted } from "@/lib/shorts-hooks";

export function ShortsManualView() {
  return (
    <ShortsShell current="manual">
      <Queue />
    </ShortsShell>
  );
}

function Queue() {
  const { data, isLoading } = useManualQueue();
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Videos the app couldn&apos;t upload itself. Post each one in YouTube Studio at the suggested time (your local clock shown), then paste
        the video URL. The app checks the URL is a public YouTube video before marking it posted.
      </p>
      {data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nothing to post by hand.</Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((v) => (
            <ManualCard key={v.id} v={v} onOpen={() => setOpen(v.id)} />
          ))}
        </div>
      )}
      {open && <VideoDetailDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

function ManualCard({ v, onOpen }: { v: ShortsVideoDto; onOpen: () => void }) {
  const [url, setUrl] = useState("");
  const mark = useMarkPosted();
  const title = v.title ?? "";
  const description = `${v.description ?? ""}\n\n#Shorts`.trim();
  const tags = v.tags.join(", ");

  const submit = async () => {
    try {
      await mark.mutateAsync({ id: v.id, url: url.trim() });
      toast.success("Marked as posted. Stats will sync now and at 24h, 72h and 7 days.");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not mark as posted");
    }
  };

  return (
    <Card className="flex gap-3 p-3">
      {v.fileUrl ? (
        <video src={v.fileUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-32 shrink-0 rounded bg-black" />
      ) : (
        <div className="aspect-[9/16] w-32 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <button type="button" className="block w-full truncate text-left font-medium hover:underline" onClick={onOpen}>
          {title}
        </button>
        <div className="flex flex-wrap gap-1 text-xs">
          <Badge variant="outline">{v.channelName}</Badge>
          <Badge variant="muted">post at {fmtWhen(v.suggestedPostAt)}</Badge>
          {v.synthetic && <Badge variant="destructive">tick &quot;altered or synthetic content&quot;</Badge>}
        </div>
        {v.manualReason && <p className="text-xs text-amber-500">{v.manualReason}</p>}
        <div className="flex flex-wrap gap-1.5">
          {v.fileUrl && (
            <Button size="sm" asChild>
              <a href={`${v.fileUrl}&download=1`}>
                <Download /> Download
              </a>
            </Button>
          )}
          <CopyButton label="Title" text={title} />
          <CopyButton label="Description" text={description} />
          <CopyButton label="Tags" text={tags} />
        </div>
        <div className="flex gap-1.5">
          <Input placeholder="https://youtube.com/shorts/..." value={url} onChange={(e) => setUrl(e.target.value)} className="h-8" />
          <Button size="sm" onClick={submit} disabled={!url.trim() || mark.isPending}>
            Mark as posted
          </Button>
        </div>
      </div>
    </Card>
  );
}
