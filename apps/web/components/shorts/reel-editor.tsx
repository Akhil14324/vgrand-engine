"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Save,
  Shuffle,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import {
  REEL_LANGUAGES,
  REEL_SUBTITLE_POSITIONS,
  REEL_SUBTITLE_PRESET_LABELS,
  REEL_SUBTITLE_PRESETS,
  REEL_TYPE_LABELS,
  REEL_VISUAL_SOURCE_LABELS,
  REEL_VISUAL_SOURCES,
  type ReelDetailDto,
  type ReelLanguage,
  type ReelScene,
  type ReelSceneDto,
  type ReelSettings,
  type ReelStudioScript,
  type ReelVisualSource,
} from "@catgpt/types";
import { ShortsShell, fmtWhen } from "@/components/shorts/shorts-shell";
import { ReelCostEstimateView, ReelPipelineSteps } from "@/components/shorts/reel-pipeline";
import { Field, ReelSetupNotice, fmtDur } from "@/components/shorts/reel-studio-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useBrands } from "@/lib/hooks";
import {
  useReel,
  useReelOptions,
  useRegenerateScene,
  useRegenerateScript,
  useRenderReel,
  useUpdateReel,
  useUploadMusic,
  useUploadSceneVisual,
} from "@/lib/shorts-reel-hooks";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiRequestError || e instanceof Error ? e.message : fallback);
const newSceneId = () => Math.random().toString(36).slice(2, 10);

type EditScript = Omit<ReelStudioScript, "scenes"> & { scenes: (ReelScene & { resolved?: ReelSceneDto["resolved"]; renderedSec?: number | null })[] };

export function ReelEditorView({ id }: { id: string }) {
  return (
    <ShortsShell current="reels">
      <Editor id={id} />
    </ShortsShell>
  );
}

function Editor({ id }: { id: string }) {
  const router = useRouter();
  const { data, isLoading, error } = useReel(id);
  const update = useUpdateReel(id);
  const render = useRenderReel(id);
  const regenScript = useRegenerateScript(id);

  const [script, setScript] = useState<EditScript | null>(null);
  const [settings, setSettings] = useState<ReelSettings | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<ReelLanguage>("en");
  const [dirty, setDirty] = useState(false);
  const [instructions, setInstructions] = useState("");
  const synced = useRef<string | null>(null);

  // Take the server copy whenever it changes and there are no unsaved edits.
  useEffect(() => {
    if (!data || dirty) return;
    const stamp = `${data.updatedAt}|${data.status}`;
    if (synced.current === stamp) return;
    synced.current = stamp;
    setScript(data.script ? structuredClone(data.script) : null);
    setSettings(structuredClone(data.settings));
    setTitle(data.title);
    setLanguage(data.language);
  }, [data, dirty]);

  const busy = data?.status === "queued" || data?.status === "rendering";
  const stale = data?.status === "completed" && data.completedAt && new Date(data.updatedAt).getTime() - new Date(data.completedAt).getTime() > 2000;

  const total = useMemo(() => {
    if (!script || !settings) return 0;
    return script.scenes.reduce((a, s) => a + s.durationSec, 0) + (settings.intro ? 1.6 : 0) + (settings.outro ? 2.6 : 0);
  }, [script, settings]);

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (error || !data) return <Card className="p-6 text-sm text-destructive">{errMsg(error, "Reel not found")}</Card>;

  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
  };
  const setScene = (i: number, patch: Partial<EditScript["scenes"][number]>) =>
    edit(() => setScript((s) => (s ? { ...s, scenes: s.scenes.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : s)));
  const setVisual = (i: number, patch: Partial<ReelScene["visual"]>) =>
    edit(() => setScript((s) => (s ? { ...s, scenes: s.scenes.map((x, j) => (j === i ? { ...x, visual: { ...x.visual, ...patch } } : x)) } : s)));
  const moveScene = (i: number, d: -1 | 1) =>
    edit(() =>
      setScript((s) => {
        if (!s) return s;
        const scenes = [...s.scenes];
        const j = i + d;
        if (j < 0 || j >= scenes.length) return s;
        [scenes[i], scenes[j]] = [scenes[j]!, scenes[i]!];
        return { ...s, scenes };
      }),
    );
  const removeScene = (i: number) => edit(() => setScript((s) => (s && s.scenes.length > 1 ? { ...s, scenes: s.scenes.filter((_, j) => j !== i) } : s)));
  const addScene = (i: number) =>
    edit(() =>
      setScript((s) => {
        if (!s || s.scenes.length >= 14) return s;
        const scenes = [...s.scenes];
        scenes.splice(i + 1, 0, {
          id: newSceneId(),
          narration: "",
          onScreenText: "",
          durationSec: 3,
          visual: { source: "auto", query: "", prompt: "", assetUrl: null, uploadFile: null, exclude: [] },
          captionText: null,
          captionOffsetSec: 0,
        });
        return { ...s, scenes };
      }),
    );

  /** Saves local edits; returns false when the save failed. */
  const save = async (): Promise<boolean> => {
    if (!dirty || !script || !settings) return true;
    try {
      const clean: ReelStudioScript = {
        title: script.title,
        hook: script.hook,
        cta: script.cta,
        caption: script.caption,
        hashtags: script.hashtags,
        scenes: script.scenes.map(({ id, narration, onScreenText, durationSec, visual, captionText, captionOffsetSec }) => ({
          id,
          narration,
          onScreenText,
          durationSec,
          visual,
          captionText: captionText?.trim() ? captionText : null,
          captionOffsetSec,
        })),
      };
      await update.mutateAsync({ title: title || script.title, language, script: { ...clean, title: title || script.title }, settings });
      setDirty(false);
      synced.current = null;
      return true;
    } catch (e) {
      toast.error(errMsg(e, "Could not save"));
      return false;
    }
  };

  const generate = async () => {
    if (!(await save())) return;
    render.mutate(undefined, {
      // Back to the generator's progress screen; only the changed scenes are redone.
      onSuccess: () => router.push(`/shorts/reels/${id}`),
      onError: (e) => toast.error(errMsg(e, "Could not start the render")),
    });
  };

  const disabled = busy || update.isPending;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/shorts/reels/${id}`} aria-label="Back to the reel">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            value={title}
            onChange={(e) => edit(() => setTitle(e.target.value))}
            disabled={disabled}
            className="h-9 font-display text-lg font-semibold"
            aria-label="Reel title"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{data.mode === "brand" ? `Brand · ${data.brandName ?? "deleted brand"}` : "General"}</Badge>
            {data.reelType && <Badge variant="muted">{REEL_TYPE_LABELS[data.reelType].label}</Badge>}
            <span>Target {data.durationSec}s · planned ≈ {total.toFixed(0)}s</span>
            <span>· created {fmtWhen(data.createdAt)}</span>
          </div>
        </div>
      </div>
      <ReelSetupNotice />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left: script + scenes */}
        <div className="space-y-4">
          {script ? (
            <>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Script</h3>
                  <span className="text-xs text-muted-foreground">Edit anything; rendering again only redoes what changed</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Opening hook">
                    <Textarea rows={2} value={script.hook} disabled={disabled} onChange={(e) => edit(() => setScript({ ...script, hook: e.target.value }))} />
                  </Field>
                  <Field label="Call to action (outro card)">
                    <Textarea rows={2} value={script.cta} disabled={disabled} onChange={(e) => edit(() => setScript({ ...script, cta: e.target.value }))} />
                  </Field>
                </div>
                <Field label="Post caption">
                  <Textarea rows={3} value={script.caption} disabled={disabled} onChange={(e) => edit(() => setScript({ ...script, caption: e.target.value }))} />
                </Field>
                <Field label="Hashtags (space separated)">
                  <Input
                    value={script.hashtags.map((h) => `#${h}`).join(" ")}
                    disabled={disabled}
                    onChange={(e) =>
                      edit(() =>
                        setScript({
                          ...script,
                          hashtags: e.target.value
                            .split(/\s+/)
                            .map((h) => h.replace(/^#+/, ""))
                            .filter(Boolean)
                            .slice(0, 30),
                        }),
                      )
                    }
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(`${script.caption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}`)
                        .then(() => toast.success("Caption copied"))
                    }
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy caption
                  </Button>
                  <div className="flex min-w-[220px] flex-1 gap-1">
                    <Input
                      placeholder="Optional: how should the new script differ?"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      disabled={busy || regenScript.isPending}
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || regenScript.isPending}
                      onClick={() => {
                        if (dirty && !confirm("Replace the whole script? Your unsaved edits are lost.")) return;
                        setDirty(false);
                        synced.current = null;
                        regenScript.mutate(instructions, {
                          onSuccess: () => toast.success("New script written"),
                          onError: (e) => toast.error(errMsg(e, "Could not rewrite the script")),
                        });
                      }}
                    >
                      {regenScript.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} New script
                    </Button>
                  </div>
                </div>
              </Card>

              <div className="space-y-3">
                {script.scenes.map((s, i) => (
                  <SceneCard
                    key={s.id}
                    reel={data}
                    scene={s}
                    index={i}
                    count={script.scenes.length}
                    disabled={disabled}
                    onChange={(p) => setScene(i, p)}
                    onVisual={(p) => setVisual(i, p)}
                    onMove={(d) => moveScene(i, d)}
                    onRemove={() => removeScene(i)}
                    onAdd={() => addScene(i)}
                    save={save}
                    resetDirty={() => {
                      setDirty(false);
                      synced.current = null;
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <Card className="p-6 text-sm text-muted-foreground">This reel has no script. Use “New script” to write one.</Card>
          )}
        </div>

        {/* Right: preview + settings */}
        <div className="space-y-4">
          <PreviewPanel reel={data} busy={busy} stale={!!stale} dirty={dirty} onGenerate={generate} pending={render.isPending || update.isPending} />
          {settings && <SettingsPanel settings={settings} language={language} disabled={disabled} reel={data} onChange={(s) => edit(() => setSettings(s))} onLanguage={(l) => edit(() => setLanguage(l))} />}
        </div>
      </div>

      {/* Sticky action bar (mobile friendly) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2">
          <span className="mr-auto truncate text-xs text-muted-foreground">
            {busy ? (data.stage ?? "Rendering…") : dirty ? "Unsaved changes" : data.status === "completed" ? (stale ? "Edited since the last render" : "Reel ready") : "Script ready"}
          </span>
          <Button variant="outline" size="sm" onClick={() => void save()} disabled={!dirty || disabled}>
            {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </Button>
          <Button size="sm" onClick={() => void generate()} disabled={busy || render.isPending || update.isPending || !script}>
            {busy || render.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {data.status === "completed" || data.renderCount > 0 ? "Render with changes" : "Generate reel"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- preview --------------------------------- */

function PreviewPanel({ reel, busy, stale, dirty, onGenerate, pending }: { reel: ReelDetailDto; busy: boolean; stale: boolean; dirty: boolean; onGenerate: () => void; pending: boolean }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Preview</h3>
        {reel.videoDurationSec && <span className="text-xs text-muted-foreground">{fmtDur(reel.videoDurationSec)} · {reel.width}×{reel.height}</span>}
      </div>
      {busy ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin" /> {reel.status === "queued" ? "Queued" : "Generating"}… {reel.progress}%
          </div>
          <Progress value={reel.progress} />
          <ReelPipelineSteps reel={reel} />
          <p className="text-[11px] text-muted-foreground">Everything runs on the server; you can leave this page. A 30 s reel usually takes a few minutes.</p>
        </div>
      ) : reel.fileUrl ? (
        <>
          <video key={reel.fileUrl} src={reel.fileUrl} poster={reel.thumbUrl ?? undefined} controls playsInline className="mx-auto aspect-[9/16] max-h-[70vh] w-full rounded-md bg-black" />
          {(stale || dirty) && <p className="text-xs text-amber-600">This video doesn’t include your latest edits yet. Click “Render with changes”.</p>}
          {reel.downloadUrl && (
            <Button asChild className="w-full">
              <a href={reel.downloadUrl}>
                <Download className="h-4 w-4" /> Download MP4
              </a>
            </Button>
          )}
        </>
      ) : (
        <div className="flex aspect-[9/16] max-h-[50vh] w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {reel.status === "failed" ? (
            <>
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <span className="text-destructive">Generation failed</span>
              <span className="line-clamp-6 text-xs">{reel.error}</span>
            </>
          ) : reel.error ? (
            <>
              <AlertTriangle className="h-6 w-6 text-amber-600" />
              <span className="line-clamp-6 text-xs text-amber-700">{reel.error}</span>
            </>
          ) : (
            <span>Review the script, then generate the reel.</span>
          )}
          <Button size="sm" onClick={onGenerate} disabled={pending}>
            <Wand2 className="h-4 w-4" /> {reel.status === "failed" ? "Try again" : "Generate reel"}
          </Button>
        </div>
      )}
      {reel.status === "failed" && <ReelPipelineSteps reel={reel} />}
      {reel.status === "failed" && reel.fileUrl && <p className="text-xs text-destructive">Last attempt failed: {reel.error}</p>}
      {!busy && <ReelCostEstimateView estimate={reel.estimate} title={reel.renderCount > 0 ? "Cost to regenerate (changed scenes only)" : "Estimated cost to generate"} />}
      {reel.warnings.length > 0 && !busy && (
        <details className="rounded-md border bg-muted/30 p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">{reel.warnings.length} note{reel.warnings.length === 1 ? "" : "s"} from the last render</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {reel.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/* ---------------------------------- scenes ---------------------------------- */

function SceneCard(props: {
  reel: ReelDetailDto;
  scene: EditScript["scenes"][number];
  index: number;
  count: number;
  disabled: boolean;
  onChange: (p: Partial<ReelScene>) => void;
  onVisual: (p: Partial<ReelScene["visual"]>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onAdd: () => void;
  save: () => Promise<boolean>;
  resetDirty: () => void;
}) {
  const { reel, scene, index, count, disabled } = props;
  const regen = useRegenerateScene(reel.id);
  const upload = useUploadSceneVisual(reel.id);
  const brands = useBrands();
  const fileRef = useRef<HTMLInputElement>(null);
  const products = reel.brandId ? (brands.data?.find((b) => b.id === reel.brandId)?.assets.filter((a) => a.kind === "product") ?? []) : [];
  const v = scene.visual;
  const r = scene.resolved;
  const working = regen.isPending || upload.isPending;

  const runRegen = async (part: "text" | "visual" | "both") => {
    if (!(await props.save())) return;
    props.resetDirty();
    regen.mutate(
      { sceneId: scene.id, part },
      {
        onSuccess: () => toast.success(part === "visual" ? "A new visual will be picked on the next render" : "Scene rewritten"),
        onError: (e) => toast.error(errMsg(e, "Could not regenerate the scene")),
      },
    );
  };

  const sources = REEL_VISUAL_SOURCES.filter((s) => (s === "brand_image" ? products.length > 0 || v.source === "brand_image" : s === "upload" ? v.source === "upload" : true));

  return (
    <Card className={cn("p-3 sm:p-4", working && "opacity-70")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{index + 1}</span>
        <span className="text-sm font-medium">{index === 0 ? "Hook" : index === count - 1 ? "Call to action" : `Scene ${index + 1}`}</span>
        {scene.renderedSec && Math.abs(scene.renderedSec - scene.durationSec) > 0.3 && (
          <span className="text-[11px] text-muted-foreground">(rendered {scene.renderedSec.toFixed(1)}s to fit the voice)</span>
        )}
        <div className="ml-auto flex gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || index === 0} onClick={() => props.onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || index === count - 1} onClick={() => props.onMove(1)} aria-label="Move down">
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || count >= 14} onClick={props.onAdd} aria-label="Add scene after">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || count <= 1} onClick={props.onRemove} aria-label="Delete scene">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
        {/* Visual thumbnail */}
        <div className="space-y-1.5">
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-md border bg-muted">
            {r?.previewUrl ? (
              r.kind === "video" ? (
                <video src={r.previewUrl} muted loop playsInline autoPlay className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.previewUrl} alt="" className="h-full w-full object-cover" />
              )
            ) : v.source === "brand_image" && v.assetUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.assetUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
                Picked on render
              </div>
            )}
          </div>
          {r && <p className="line-clamp-2 text-[10px] text-muted-foreground" title={r.note ?? ""}>{r.note}{r.author ? ` · ${r.author}` : ""}</p>}
        </div>

        <div className="space-y-2.5">
          <Field label="Voiceover">
            <Textarea rows={2} value={scene.narration} disabled={disabled} onChange={(e) => props.onChange({ narration: e.target.value })} placeholder="What the voice says (leave empty for a silent moment)" />
          </Field>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
            <Field label="On-screen text">
              <Input value={scene.onScreenText} maxLength={90} disabled={disabled} onChange={(e) => props.onChange({ onScreenText: e.target.value })} placeholder="Animated headline" />
            </Field>
            <Field label={`Duration: ${scene.durationSec.toFixed(1)}s`}>
              <input
                type="range"
                min={1.5}
                max={15}
                step={0.5}
                value={scene.durationSec}
                disabled={disabled}
                onChange={(e) => props.onChange({ durationSec: Number(e.target.value) })}
                className="mt-2 w-full accent-[hsl(var(--primary))]"
              />
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Visual source">
              <Select value={v.source} disabled={disabled} onChange={(e) => props.onVisual({ source: e.target.value as ReelVisualSource })}>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {REEL_VISUAL_SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            {v.source === "brand_image" ? (
              <Field label="Product photo">
                <div className="flex gap-1 overflow-x-auto">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => props.onVisual({ assetUrl: p.url })}
                      className={cn("h-9 w-9 shrink-0 overflow-hidden rounded border-2", v.assetUrl === p.url ? "border-primary" : "border-transparent")}
                      title={p.label ?? ""}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.label ?? ""} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <Field label="Search words (stock)">
                <Input value={v.query} disabled={disabled} maxLength={120} onChange={(e) => props.onVisual({ query: e.target.value })} placeholder="e.g. chef plating pasta" />
              </Field>
            )}
          </div>
          <details className="rounded-md border px-2 py-1.5" open={!!scene.captionText || scene.captionOffsetSec !== 0}>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Subtitle text & timing{scene.captionText ? " · custom text" : ""}
              {scene.captionOffsetSec !== 0 ? ` · ${scene.captionOffsetSec > 0 ? "+" : ""}${scene.captionOffsetSec.toFixed(1)}s` : ""}
            </summary>
            <div className="mt-2 space-y-2">
              <Textarea
                rows={2}
                maxLength={600}
                value={scene.captionText ?? ""}
                disabled={disabled}
                placeholder={scene.narration ? `Same as the voiceover: “${scene.narration.slice(0, 80)}${scene.narration.length > 80 ? "…" : ""}”` : "Subtitle text"}
                onChange={(e) => props.onChange({ captionText: e.target.value ? e.target.value : null })}
              />
              <Slider
                label={`Timing shift (${scene.captionOffsetSec > 0 ? "later" : scene.captionOffsetSec < 0 ? "earlier" : "in sync"})`}
                value={scene.captionOffsetSec}
                min={-2}
                max={2}
                step={0.1}
                disabled={disabled}
                onChange={(x) => props.onChange({ captionOffsetSec: Math.round(x * 10) / 10 })}
                unit="s"
              />
              <p className="text-[11px] text-muted-foreground">Leave the text empty to show exactly what the voice says, word-synced. Custom text is spread over the voice’s length.</p>
            </div>
          </details>
          {(v.source === "ai_image" || v.source === "ai_video" || v.source === "auto") && (
            <Field label="AI visual prompt">
              <Textarea rows={2} value={v.prompt} disabled={disabled} maxLength={800} onChange={(e) => props.onVisual({ prompt: e.target.value })} />
            </Field>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="outline" disabled={disabled || working} onClick={() => void runRegen("visual")}>
              <Shuffle className="h-3.5 w-3.5" /> New visual
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || working} onClick={() => void runRegen("text")}>
              {regen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rewrite text
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || working} onClick={() => void runRegen("both")}>
              <Wand2 className="h-3.5 w-3.5" /> Regenerate scene
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || working} onClick={() => fileRef.current?.click()}>
              {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (!(await props.save())) return;
                props.resetDirty();
                upload.mutate(
                  { sceneId: scene.id, file },
                  { onSuccess: () => toast.success("Uploaded; it will be used on the next render"), onError: (err) => toast.error(errMsg(err, "Upload failed")) },
                );
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------- settings --------------------------------- */

function SettingsPanel({
  settings: s,
  language,
  disabled,
  reel,
  onChange,
  onLanguage,
}: {
  settings: ReelSettings;
  language: ReelLanguage;
  disabled: boolean;
  reel: ReelDetailDto;
  onChange: (s: ReelSettings) => void;
  onLanguage: (l: ReelLanguage) => void;
}) {
  const { data: opts } = useReelOptions();
  const uploadMusic = useUploadMusic();
  const musicRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ReelSettings>) => onChange({ ...s, ...patch });
  const sub = (patch: Partial<ReelSettings["subtitles"]>) => onChange({ ...s, subtitles: { ...s.subtitles, ...patch } });
  const track = opts?.music.find((m) => m.key === s.musicTrack);

  return (
    <Card className="space-y-4 p-4">
      <h3 className="font-semibold">Voice, subtitles, music & style</h3>

      <Section title="Voiceover">
        <Toggle label="AI voiceover" checked={s.voiceEnabled} disabled={disabled} onChange={(v) => set({ voiceEnabled: v })} />
        {s.voiceEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Voice">
              <Select value={s.voiceGender} disabled={disabled} onChange={(e) => set({ voiceGender: e.target.value as "female" | "male" })}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </Field>
            <Field label="Language">
              <Select value={language} disabled={disabled} onChange={(e) => onLanguage(e.target.value as ReelLanguage)}>
                {REEL_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Provider">
              <Select value={s.voiceProvider} disabled={disabled} onChange={(e) => set({ voiceProvider: e.target.value as ReelSettings["voiceProvider"] })}>
                <option value="auto">Auto</option>
                <option value="elevenlabs" disabled={opts ? !opts.features.voice.elevenlabs : false}>
                  ElevenLabs
                </option>
                <option value="openai" disabled={opts ? !opts.features.voice.openai : false}>
                  OpenAI
                </option>
              </Select>
            </Field>
            <Field label="Custom voice id">
              <Input value={s.voiceId ?? ""} disabled={disabled} placeholder="optional" onChange={(e) => set({ voiceId: e.target.value.trim() || null })} />
            </Field>
            <div className="col-span-2">
              <Field label="Delivery style">
                <Input value={s.voiceStyle} disabled={disabled} maxLength={200} onChange={(e) => set({ voiceStyle: e.target.value })} />
              </Field>
            </div>
          </div>
        )}
        {language !== reel.language && <p className="text-[11px] text-amber-600">Changing the language only changes the voice. Use “New script” to rewrite the text in the new language.</p>}
        <Slider label="Voice volume" value={s.voiceVolume} min={0} max={2} step={0.05} disabled={disabled || !s.voiceEnabled} onChange={(v) => set({ voiceVolume: v })} pct />
      </Section>

      <Section title="Subtitles">
        <Toggle label="Burn in subtitles" checked={s.subtitles.enabled} disabled={disabled} onChange={(v) => sub({ enabled: v })} />
        {s.subtitles.enabled && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Style">
              <Select value={s.subtitles.preset} disabled={disabled} onChange={(e) => sub({ preset: e.target.value as ReelSettings["subtitles"]["preset"] })}>
                {REEL_SUBTITLE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {REEL_SUBTITLE_PRESET_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Position">
              <Select value={s.subtitles.position} disabled={disabled} onChange={(e) => sub({ position: e.target.value as ReelSettings["subtitles"]["position"] })}>
                {REEL_SUBTITLE_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p[0]!.toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Text colour">
              <input type="color" value={s.subtitles.textColor} disabled={disabled} onChange={(e) => sub({ textColor: e.target.value.toUpperCase() })} className="h-9 w-full rounded border" />
            </Field>
            <Field label="Highlight colour">
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={s.subtitles.highlightColor ?? "#FFD400"}
                  disabled={disabled}
                  onChange={(e) => sub({ highlightColor: e.target.value.toUpperCase() })}
                  className="h-9 w-full rounded border"
                />
                {s.subtitles.highlightColor && (
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-[10px]" onClick={() => sub({ highlightColor: null })} disabled={disabled}>
                    Brand
                  </Button>
                )}
              </div>
            </Field>
            <div className="col-span-2">
              <Slider label="Text size" value={s.subtitles.size} min={0.6} max={1.6} step={0.05} disabled={disabled} onChange={(v) => sub({ size: v })} pct />
            </div>
            <div className="col-span-2">
              <Toggle label="Highlight important words (numbers, key terms)" checked={s.subtitles.emphasis} disabled={disabled} onChange={(v) => sub({ emphasis: v })} />
              <Slider
                label="Timing shift, all subtitles"
                value={s.subtitles.offsetSec}
                min={-1.5}
                max={1.5}
                step={0.05}
                disabled={disabled}
                onChange={(v) => sub({ offsetSec: Math.round(v * 100) / 100 })}
                unit="s"
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="Background music">
        <Field label="Music">
          <Select
            value={s.musicMode === "track" ? (s.musicTrack ?? "") : s.musicMode}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "auto" || v === "none") set({ musicMode: v });
              else set({ musicMode: "track", musicTrack: v });
            }}
          >
            <option value="auto">Auto pick</option>
            <option value="none">No music</option>
            {opts?.music.map((m) => (
              <option key={m.key} value={m.key}>
                {m.mine ? "★ " : ""}
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {s.musicMode === "track" && track && <audio src={track.url} controls className="h-8 w-full" />}
        {s.musicMode === "auto" && s.musicTrack && (
          <p className="text-[11px] text-muted-foreground">Last render used: {opts?.music.find((m) => m.key === s.musicTrack)?.label ?? s.musicTrack.replace(/^(lib|mine|builtin):/, "")}</p>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={disabled || uploadMusic.isPending} onClick={() => musicRef.current?.click()}>
            {uploadMusic.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music className="h-3.5 w-3.5" />} Upload track
          </Button>
          <span className="text-[11px] text-muted-foreground">Only music you have the rights to use.</span>
          <input
            ref={musicRef}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,.mp3,.m4a,.aac,.wav,.ogg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              uploadMusic.mutate(file, {
                onSuccess: (d) => {
                  set({ musicMode: "track", musicTrack: d.key });
                  toast.success("Track added");
                },
                onError: (err) => toast.error(errMsg(err, "Upload failed")),
              });
            }}
          />
        </div>
        <Slider label="Music volume" value={s.musicVolume} min={0} max={1} step={0.05} disabled={disabled || s.musicMode === "none"} onChange={(v) => set({ musicVolume: v })} pct />
      </Section>

      <Section title="Style & editing">
        <Field label="Template">
          <Select value={s.template} disabled={disabled} onChange={(e) => set({ template: e.target.value as ReelSettings["template"] })}>
            {opts?.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <Toggle label="Intro card" checked={s.intro} disabled={disabled} onChange={(v) => set({ intro: v })} />
          <Toggle label="Sound effects" checked={s.sfx} disabled={disabled} onChange={(v) => set({ sfx: v })} />
          <Toggle label="Outro / CTA card" checked={s.outro} disabled={disabled} onChange={(v) => set({ outro: v })} />
          {reel.mode === "brand" && <Toggle label="Logo watermark" checked={s.showLogo} disabled={disabled} onChange={(v) => set({ showLogo: v })} />}
          <Toggle label="AI images" checked={s.allowAiImages} disabled={disabled} onChange={(v) => set({ allowAiImages: v })} />
          <Toggle label="Prefer AI over stock" checked={s.preferAi} disabled={disabled || !s.allowAiImages} onChange={(v) => set({ preferAi: v })} />
          <Toggle
            label="AI video clips (metered)"
            checked={s.allowAiVideo}
            disabled={disabled || (opts ? !opts.features.aiVideo : false)}
            onChange={(v) => set({ allowAiVideo: v })}
          />
        </div>
        {s.sfx && <Slider label="Sound effects volume" value={s.sfxVolume} min={0} max={1} step={0.05} disabled={disabled} onChange={(v) => set({ sfxVolume: v })} pct />}
        <Field label="Resolution">
          <Select value={s.resolution} disabled={disabled} onChange={(e) => set({ resolution: e.target.value as ReelSettings["resolution"] })}>
            <option value="1080p">1080 × 1920 (Full HD)</option>
            <option value="720p">720 × 1280 (faster)</option>
          </Select>
        </Field>
      </Section>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </label>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (v: number) => void; pct?: boolean; unit?: string }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="flex justify-between text-muted-foreground">
        <span>{props.label}</span>
        <span className="tabular-nums">{props.pct ? `${Math.round(props.value * 100)}%` : props.unit ? `${props.value > 0 ? "+" : ""}${props.value.toFixed(props.step < 0.1 ? 2 : 1)}${props.unit}` : props.value}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-[hsl(var(--primary))]"
      />
    </label>
  );
}
