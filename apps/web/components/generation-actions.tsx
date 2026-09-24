"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileDown,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { GenerationDto, Quality } from "@catgpt/types";
import {
  useDeleteGeneration,
  useExportPdf,
  useRegenerate,
  useShareGeneration,
} from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

async function downloadImage(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function RegenerateButton({ generation }: { generation: GenerationDto }) {
  const regenerate = useRegenerate();
  const { select } = useStudio();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(generation.prompt);
  const [quality, setQuality] = useState<Quality>("medium");

  const run = () => {
    regenerate.mutate(
      { id: generation.id, prompt: prompt.trim() || undefined, quality },
      {
        onSuccess: (res) => {
          setOpen(false);
          select(res.generationId);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Regenerate">
              <RefreshCw />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit & regenerate</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit & regenerate</DialogTitle>
          <DialogDescription>
            Runs on gpt-image-2.5-sunburst — keeps the current image intact and
            changes only what you describe.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[100px]"
          placeholder="e.g. same layout, but change the offer to 30% off"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {(["low", "medium", "high"] as Quality[]).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs capitalize transition-colors",
                  quality === q
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          <Button onClick={run} disabled={regenerate.isPending}>
            {regenerate.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Regenerate
          </Button>
        </div>
        {regenerate.isError && (
          <p className="text-xs text-destructive">{regenerate.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ActionRow({
  generation,
  className,
}: {
  generation: GenerationDto;
  className?: string;
}) {
  const share = useShareGeneration();
  const del = useDeleteGeneration();
  const exportPdf = useExportPdf();
  const { select, selectedId } = useStudio();
  const [copied, setCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const ready =
    generation.status === "completed" && generation.imageUrls.length > 0;
  const textReady =
    generation.status === "completed" &&
    generation.kind === "text" &&
    Boolean(generation.textResponse);
  const canSpeak =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Browser TTS — instant and free. Markdown is flattened so the voice reads
  // prose, not syntax; fenced code collapses to "code block".
  const speak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const plain = (generation.textResponse ?? "")
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#+\s*/gm, "")
      .replace(/[*_~>]/g, "")
      .replace(/\n{2,}/g, ". ")
      .slice(0, 4000);
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-0.5", className)}>
      {textReady && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy reply"
              onClick={() => {
                void navigator.clipboard.writeText(generation.textResponse!);
                setTextCopied(true);
                setTimeout(() => setTextCopied(false), 1500);
              }}
            >
              {textCopied ? <Check className="text-primary" /> : <Copy />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{textCopied ? "Copied" : "Copy reply"}</TooltipContent>
        </Tooltip>
      )}
      {textReady && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Export as PDF"
              disabled={exportPdf.isPending}
              onClick={() =>
                exportPdf.mutate(generation.id, {
                  onSuccess: ({ url }) => {
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `prompthub-${generation.id}.pdf`;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  },
                })
              }
            >
              {exportPdf.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileDown />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export as PDF</TooltipContent>
        </Tooltip>
      )}
      {textReady && canSpeak && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={speaking ? "Stop reading" : "Read aloud"}
              onClick={speak}
            >
              {speaking ? <VolumeX /> : <Volume2 />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {speaking ? "Stop reading" : "Read aloud"}
          </TooltipContent>
        </Tooltip>
      )}
      {ready && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy share link"
              onClick={() =>
                share.mutate(generation.id, {
                  onSuccess: (link) => {
                    void navigator.clipboard.writeText(link.url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                })
              }
            >
              {copied ? (
                <Check className="text-primary" />
              ) : share.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Link2 />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {copied ? "Link copied" : "Copy share link"}
          </TooltipContent>
        </Tooltip>
      )}
      {ready && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Download"
              onClick={() =>
                downloadImage(
                  generation.imageUrls[0]!,
                  `catgpt-${generation.id}.png`,
                )
              }
            >
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
      )}
      {ready && <RegenerateButton generation={generation} />}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              del.mutate(generation.id);
              if (selectedId === generation.id) select(null);
            }}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </div>
  );
}
