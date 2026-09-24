"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderPlus, Trash2 } from "lucide-react";
import type { BoardDto } from "@catgpt/types";
import { useBoards, useCreateBoard, useRemoveBoardItem } from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function BoardsView() {
  const router = useRouter();
  const { data: boards } = useBoards();
  const createBoard = useCreateBoard();
  const removeItem = useRemoveBoardItem();
  const { select } = useStudio();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const active = boards?.find((b) => b.id === activeId) ?? boards?.[0];

  const openInStudio = (generationId: string) => {
    select(generationId);
    router.push("/");
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createBoard.mutate(name, {
      onSuccess: (b) => {
        setNewName("");
        setActiveId(b.id);
      },
    });
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-display text-lg font-semibold tracking-tight">
          Boards
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[260px_1fr]">
        {/* Board picker — horizontal chip strip on mobile */}
        <div className="border-b md:hidden">
          <form className="flex gap-2 px-3 pt-3" onSubmit={create}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New board…"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary">
              <FolderPlus />
            </Button>
          </form>
          <div className="flex gap-1.5 overflow-x-auto px-3 py-3">
            {(boards ?? []).map((b) => (
              <BoardChip
                key={b.id}
                board={b}
                active={active?.id === b.id}
                onClick={() => setActiveId(b.id)}
              />
            ))}
            {boards?.length === 0 && (
              <p className="py-1 text-xs text-muted-foreground">
                Save generations to boards from the feed.
              </p>
            )}
          </div>
        </div>

        {/* Board list — side column on md+ */}
        <div className="hidden min-h-0 flex-col border-r md:flex">
          <form className="flex gap-2 p-3" onSubmit={create}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New board…"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary">
              <FolderPlus />
            </Button>
          </form>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 p-2">
              {(boards ?? []).map((b) => (
                <button
                  key={b.id}
                  onClick={() => setActiveId(b.id)}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    active?.id === b.id ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span className="truncate">{b.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.items.length}
                  </span>
                </button>
              ))}
              {boards?.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Save generations to boards from the feed.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 sm:p-4 md:p-6">
            {active ? (
              <>
                <h2 className="mb-4 font-display text-base font-semibold">
                  {active.name}
                </h2>
                {active.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing saved here yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {active.items.map((item) => {
                      const src = item.generation?.imageUrls[0];
                      return (
                        <div
                          key={item.id}
                          className="group relative aspect-square overflow-hidden rounded-lg border bg-muted/40"
                        >
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={src}
                              alt={item.generation?.prompt ?? ""}
                              className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-[1.02]"
                              onClick={() => openInStudio(item.generationId)}
                            />
                          ) : (
                            <div className="shimmer h-full w-full" />
                          )}
                          <button
                            onClick={() =>
                              removeItem.mutate({
                                boardId: active.id,
                                itemId: item.id,
                              })
                            }
                            className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 backdrop-blur transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="Remove from board"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Create a board to start collecting generations.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function BoardChip({
  board,
  active,
  onClick,
}: {
  board: BoardDto;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border text-muted-foreground",
      )}
    >
      {board.name}
      <span className="ml-1.5 opacity-70">{board.items.length}</span>
    </button>
  );
}
