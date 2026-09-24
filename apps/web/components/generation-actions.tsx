"use client";

import { useState } from "react";
import {
  BookmarkPlus,
  Check,
  Copy,
  Download,
  FileDown,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { GenerationDto, Quality } from "@catgpt/types";
import {
  useBoards,
  useCreateBoard,
  useDeleteGeneration,
  useExportPdf,
  useRegenerate,
  useSaveToBoard,
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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
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

export function SaveToBoard({ generation }: { generation: GenerationDto }) {
  const { data: boards } = useBoards();
  const save = useSaveToBoard();
  const createBoard = useCreateBoard();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [savedTo, setSavedTo] = useState<string | null>(null);

  const saveTo = (boardId: string) =>
    save.mutate(
      { boardId, generationId: generation.id },
      {
        onSuccess: () => {
          setSavedTo(boardId);
          setTimeout(() => setOpen(false), 500);
        },
      },
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Save to board">
              <BookmarkPlus />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Save to board</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-60 p-2" align="end">
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
          Save to board
        </div>
        <div className="max-h-44 overflow-y-auto">
          {(boards ?? []).map((b) => (
            <button
              key={b.id}
              onClick={() => saveTo(b.id)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="truncate">{b.name}</span>
              {savedTo === b.id ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {b.items.length}
                </span>
              )}
            </button>
          ))}
          {boards?.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              No boards yet — create one below.
            </p>
          )}
        </div>
        <Separator className="my-1.5" />
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            createBoard.mutate(name, {
              onSuccess: (board) => {
                setNewName("");
                saveTo(board.id);
              },
            });
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New board…"
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm" variant="secondary">
            Add
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
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
  const ready =
    generation.status === "completed" && generation.imageUrls.length > 0;
  const textReady =
    generation.status === "completed" &&
    generation.kind === "text" &&
    Boolean(generation.textResponse);

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
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
      {ready && <SaveToBoard generation={generation} />}
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
