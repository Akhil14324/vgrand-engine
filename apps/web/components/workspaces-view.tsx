"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  FileText,
  FolderPlus,
  Loader2,
  MessageSquare,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { DocumentDto } from "@catgpt/types";
import { apiFetch } from "@/lib/api";
import {
  useCreateWorkspace,
  useDeleteDocument,
  useDeleteWorkspace,
  useRenameWorkspace,
  useWorkspace,
  useWorkspaces,
} from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const DOC_ACCEPT =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,.doc,.docx";

export function WorkspacesView() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: workspaces } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const { openWorkspaceChat } = useStudio();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const active = workspaces?.find((w) => w.id === activeId) ?? workspaces?.[0];

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createWorkspace.mutate(name, {
      onSuccess: (w) => {
        setNewName("");
        setActiveId(w.id);
      },
    });
  };

  const openChat = () => {
    if (!active) return;
    openWorkspaceChat(active.id);
    router.push("/");
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
          Workspaces
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[260px_1fr]">
        {/* Workspace picker — horizontal chip strip on mobile */}
        <div className="border-b md:hidden">
          <form className="flex gap-2 px-3 pt-3" onSubmit={create}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New workspace…"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary">
              <FolderPlus />
            </Button>
          </form>
          <div className="flex gap-1.5 overflow-x-auto px-3 py-3">
            {(workspaces ?? []).map((w) => (
              <WorkspaceChip
                key={w.id}
                name={w.name}
                count={w.documentCount}
                active={active?.id === w.id}
                onClick={() => setActiveId(w.id)}
              />
            ))}
            {workspaces?.length === 0 && (
              <p className="py-1 text-xs text-muted-foreground">
                Create a workspace to group documents + chats.
              </p>
            )}
          </div>
        </div>

        {/* Workspace list — side column on md+ */}
        <div className="hidden min-h-0 flex-col border-r md:flex">
          <form className="flex gap-2 p-3" onSubmit={create}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New workspace…"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary">
              <FolderPlus />
            </Button>
          </form>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 p-2">
              {(workspaces ?? []).map((w) => (
                <button
                  key={w.id}
                  onClick={() => setActiveId(w.id)}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    active?.id === w.id ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span className="truncate">{w.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {w.documentCount}
                  </span>
                </button>
              ))}
              {workspaces?.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Create a workspace to group documents + chats.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 sm:p-4 md:p-6">
            {active ? (
              <WorkspaceDetail
                workspaceId={active.id}
                onOpenChat={openChat}
                onChanged={() =>
                  qc.invalidateQueries({ queryKey: ["workspaces"] })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Create a workspace — everything you drop inside grounds every
                chat opened from it.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function WorkspaceDetail({
  workspaceId,
  onOpenChat,
  onChanged,
}: {
  workspaceId: string;
  onOpenChat: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: workspace } = useWorkspace(workspaceId);
  const rename = useRenameWorkspace();
  const del = useDeleteWorkspace();
  const deleteDoc = useDeleteDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  if (!workspace) {
    return <div className="shimmer h-40 w-full rounded-xl" />;
  }

  const upload = async (files: FileList) => {
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("workspaceId", workspaceId);
        await apiFetch("/documents", { method: "POST", body: form });
      }
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
      onChanged();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept={DOC_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              rename.mutate(
                { id: workspaceId, name: n },
                { onSuccess: () => setRenaming(false) },
              );
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 w-48 text-sm"
            />
            <Button size="icon" variant="ghost" className="h-8 w-8">
              <Check className="h-3.5 w-3.5" />
            </Button>
          </form>
        ) : (
          <h2 className="font-display text-base font-semibold">
            {workspace.name}
          </h2>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!renaming && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rename workspace"
              onClick={() => {
                setName(workspace.name);
                setRenaming(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Add document
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={onOpenChat}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Open chat
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete workspace"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => del.mutate(workspaceId)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Chats opened from this workspace answer using every ready document
        here — nothing needs re-attaching.
      </p>

      {uploadError && (
        <p className="text-xs text-destructive">{uploadError}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {workspace.documents.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            onDelete={() => deleteDoc.mutate(d.id)}
          />
        ))}
        {workspace.documents.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No documents yet — add PDFs or Word docs to ground this
            workspace's answers.
          </p>
        )}
      </div>
    </div>
  );
}

function DocRow({
  doc,
  onDelete,
}: {
  doc: DocumentDto;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-2.5 rounded-lg border bg-card/60 px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <button
        onClick={() =>
          doc.storageUrl && window.open(doc.storageUrl, "_blank", "noopener")
        }
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
        aria-label={`Open ${doc.filename}`}
      >
        {doc.filename}
      </button>
      <Badge
        variant={
          doc.status === "ready"
            ? "muted"
            : doc.status === "failed"
              ? "destructive"
              : "secondary"
        }
        className="text-[10px]"
      >
        {doc.status}
      </Badge>
      <button
        onClick={onDelete}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Delete ${doc.filename}`}
      >
        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
}

function WorkspaceChip({
  name,
  count,
  active,
  onClick,
}: {
  name: string;
  count: number;
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
      {name}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}
