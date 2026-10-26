"use client";

import { RequireAuth } from "@/components/require-auth";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FolderPlus, Trash2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { SourceAssetDto } from "@catgpt/types";
import { useBrands } from "@/lib/hooks";
import {
  useCreateSourceFolder,
  useDeleteSourceAsset,
  useDeleteSourceFolder,
  useSourceFolder,
  useSourceFolders,
  useUploadSourceAsset,
  useVideoBudget,
} from "@/lib/video-hooks";
import { ApiRequestError } from "@/lib/api";
import { ReelProjectsPanel } from "@/components/reel-projects";
import { ReelPlanPanel } from "@/components/reel-plan";
import { ReelSettingsPanel } from "@/components/reel-settings";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime"];

export function ReelsView() {
  return (
    <RequireAuth>
      <Reels />
    </RequireAuth>
  );
}

function Reels() {
  const brands = useBrands();
  const [brandId, setBrandId] = useState<string | null>(null);
  const activeBrandId = brandId ?? brands.data?.[0]?.id ?? null;
  const [folderId, setFolderId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const folders = useSourceFolders(activeBrandId);
  const folder = useSourceFolder(folderId);
  const detail = folder.data;
  const budget = useVideoBudget();
  const createFolder = useCreateSourceFolder();
  const deleteFolder = useDeleteSourceFolder();

  const onCreate = async () => {
    const name = newName.trim();
    if (!name || !activeBrandId) return;
    try {
      const created = await createFolder.mutateAsync({ brandId: activeBrandId, name });
      setNewName("");
      setFolderId(created.id);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not create the folder");
    }
  };

  const onDeleteFolder = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and all its files? This can't be undone.`)) return;
    try {
      const target = folders.data?.find((f) => f.id === id);
      if (target) await deleteFolder.mutateAsync(target);
      if (folderId === id) setFolderId(null);
      toast.success("Folder deleted");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not delete the folder");
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-display text-lg font-semibold tracking-tight">Reels</h1>
        <select
          aria-label="Brand"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={activeBrandId ?? ""}
          onChange={(e) => {
            setBrandId(e.target.value);
            setFolderId(null);
          }}
        >
          {brands.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {budget.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            Video spend this month: ${budget.data.spentUsd.toFixed(2)}
            {budget.data.capUsd !== null && ` of $${budget.data.capUsd.toFixed(2)}`}
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-3 sm:p-4 md:grid-cols-[260px_1fr]">
        <aside className="min-h-0 space-y-3 overflow-y-auto">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New folder name"
              maxLength={120}
              onKeyDown={(e) => e.key === "Enter" && void onCreate()}
            />
            <Button size="icon" onClick={() => void onCreate()} disabled={!newName.trim() || createFolder.isPending} aria-label="Create folder">
              <FolderPlus />
            </Button>
          </div>
          {folders.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No folders yet. Create one, then add footage.</p>
          )}
          <ul className="space-y-1">
            {folders.data?.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setFolderId(f.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                    folderId === f.id && "bg-accent font-medium",
                  )}
                >
                  <span className="truncate">{f.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {f.videoCount}v · {f.imageCount}p
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <ReelSettingsPanel />
        </aside>

        <section className="min-h-0 overflow-y-auto">
          {!folderId && <p className="text-sm text-muted-foreground">Pick a folder to see its footage.</p>}
          {folderId && detail && (
            <FolderPanel
              folderId={folderId}
              name={detail.name}
              assets={detail.assets}
              onDeleteFolder={() => void onDeleteFolder(folderId, detail.name)}
            />
          )}
          {activeBrandId && <ReelProjectsPanel brandId={activeBrandId} folderId={folderId} />}
          {activeBrandId && <ReelPlanPanel brandId={activeBrandId} folderId={folderId} />}
        </section>
      </div>
    </div>
  );
}

function FolderPanel({
  folderId,
  name,
  assets,
  onDeleteFolder,
}: {
  folderId: string;
  name: string;
  assets: SourceAssetDto[];
  onDeleteFolder: () => void;
}) {
  const qc = useQueryClient();
  const upload = useUploadSourceAsset(folderId);
  const removeAsset = useDeleteSourceAsset(folderId);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // Uploads go one file at a time: a single failure is reported and the rest still land.
  const uploadFiles = async (picked: FileList | null) => {
    if (!picked) return;
    const files = Array.from(picked).filter((f) => ACCEPTED.includes(f.type));
    const skipped = picked.length - files.length;
    if (files.length === 0) {
      toast.error("No supported files found. Use PNG, JPEG, WebP, MP4 or MOV.");
      return;
    }
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length });
      try {
        await upload.mutateAsync(files[i]!);
      } catch {
        failed++;
      }
    }
    setProgress(null);
    void qc.invalidateQueries({ queryKey: ["video-folder", folderId] });
    const uploaded = files.length - failed;
    const notes = [
      `${uploaded} added`,
      failed ? `${failed} failed` : null,
      skipped ? `${skipped} skipped (unsupported)` : null,
    ].filter(Boolean);
    if (failed) toast.error(notes.join(", "));
    else toast.success(notes.join(", "));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-semibold">{name}</h2>
        <span className="text-xs text-muted-foreground">{assets.length} files</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={progress !== null}>
            <Upload /> Add files
          </Button>
          <Button variant="outline" size="sm" onClick={() => folderInput.current?.click()} disabled={progress !== null}>
            <Upload /> Add folder
          </Button>
          <Button variant="ghost" size="sm" onClick={onDeleteFolder} aria-label="Delete folder">
            <Trash2 />
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => {
            void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          // webkitdirectory isn't in React's typings; it selects a whole folder in Chromium and Safari.
          {...({ webkitdirectory: "" } as Record<string, string>)}
          className="hidden"
          onChange={(e) => {
            void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {progress && (
        <p className="text-sm text-muted-foreground">
          Uploading {progress.done + 1} of {progress.total}…
        </p>
      )}

      {assets.length === 0 && !progress && (
        <p className="text-sm text-muted-foreground">No files yet. Add footage or photos from your computer.</p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((a) => (
          <li key={a.id} className="group relative overflow-hidden rounded-lg border bg-muted">
            {a.kind === "video" ? (
              <video src={a.url} className="aspect-[9/16] w-full object-cover" preload="metadata" muted controls />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt={a.fileName} className="aspect-[9/16] w-full object-cover" />
            )}
            <div className="flex items-center justify-between gap-2 p-2 text-xs">
              <span className="truncate" title={a.fileName}>
                {a.fileName}
              </span>
              {a.durationSec !== null && <span className="shrink-0 text-muted-foreground">{a.durationSec}s</span>}
            </div>
            <button
              type="button"
              onClick={() => removeAsset.mutate(a.id)}
              aria-label={`Remove ${a.fileName}`}
              className="absolute right-1 top-1 rounded-md bg-background/80 p-1 opacity-0 transition group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
