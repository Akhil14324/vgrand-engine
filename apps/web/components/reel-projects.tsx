"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import {
  REEL_ASPECT_RATIOS,
  REEL_MAX_SECONDS,
  REEL_MIN_SECONDS,
  REEL_SHOT_KINDS,
  VIDEO_MODELS,
  VOICE_PROVIDERS,
  validateReelScript,
  type ReelScript,
  type ReelShot,
  type VideoProjectDto,
} from "@catgpt/types";
import { ApiRequestError } from "@/lib/api";
import {
  useCreateVideoProject,
  useDeleteVideoProject,
  useRenderVideoProject,
  useSaveVideoScript,
  useVideoProject,
  useVideoProjects,
  useWriteVideoScript,
} from "@/lib/video-hooks";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scripting: "Writing script",
  scripted: "Script ready",
  generating: "Generating",
  editing: "Editing",
  review: "Ready for review",
  approved: "Approved",
  failed: "Failed",
  cancelled: "Cancelled",
};

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiRequestError ? err.message : fallback;

export function ReelProjectsPanel({ brandId, folderId }: { brandId: string; folderId: string | null }) {
  const projects = useVideoProjects(brandId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteProject = useDeleteVideoProject();

  const onDelete = async (p: VideoProjectDto) => {
    if (!window.confirm(`Delete the reel "${p.title}"?`)) return;
    try {
      await deleteProject.mutateAsync(p);
      if (selectedId === p.id) setSelectedId(null);
      toast.success("Reel deleted");
    } catch (err) {
      toast.error(errorText(err, "Could not delete the reel"));
    }
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold">Reels</h3>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setCreating((v) => !v)}>
          <Plus /> New reel
        </Button>
      </div>

      {creating && (
        <NewReelForm
          brandId={brandId}
          folderId={folderId}
          onCreated={(p) => {
            setCreating(false);
            setSelectedId(p.id);
          }}
        />
      )}

      {projects.data?.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground">No reels yet. Create one to write its script.</p>
      )}

      <ul className="space-y-1">
        {projects.data?.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                selectedId === p.id && "bg-accent font-medium",
              )}
            >
              <span className="truncate">{p.title}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[p.status] ?? p.status}</span>
            </button>
            <Button variant="ghost" size="icon" onClick={() => void onDelete(p)} aria-label={`Delete ${p.title}`}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>

      {selectedId && <ReelEditor id={selectedId} />}
    </div>
  );
}

function NewReelForm({
  brandId,
  folderId,
  onCreated,
}: {
  brandId: string;
  folderId: string | null;
  onCreated: (p: VideoProjectDto) => void;
}) {
  const create = useCreateVideoProject();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [durationSec, setDurationSec] = useState(15);
  const [aspectRatio, setAspectRatio] = useState<(typeof REEL_ASPECT_RATIOS)[number]>("9:16");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [videoModel, setVideoModel] = useState<string>("veo-3.1-lite");
  const [voiceProvider, setVoiceProvider] = useState<(typeof VOICE_PROVIDERS)[number]>("none");
  const [voiceId, setVoiceId] = useState("");

  const canSave = title.trim().length > 0 && goal.trim().length >= 3 && !create.isPending;

  const submit = async () => {
    try {
      const p = await create.mutateAsync({
        brandId,
        folderId,
        title: title.trim(),
        brief: {
          goal: goal.trim(),
          durationSec,
          aspectRatio,
          resolution,
          videoModel: videoModel as never,
          voiceProvider,
          voiceId: voiceId.trim() || null,
        },
      });
      toast.success("Reel created. Write its script next.");
      onCreated(p);
    } catch (err) {
      toast.error(errorText(err, "Could not create the reel"));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={120} />
      <Textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="What should this reel do? e.g. announce the weekend menu"
        maxLength={500}
        rows={3}
      />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Length (seconds)</span>
          <Input
            type="number"
            min={REEL_MIN_SECONDS}
            max={REEL_MAX_SECONDS}
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Aspect ratio</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}
          >
            {REEL_ASPECT_RATIOS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Video model</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2"
            value={videoModel}
            onChange={(e) => setVideoModel(e.target.value)}
          >
            {VIDEO_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} (${m.pricePerSecondUsd[resolution]}/s)
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Resolution</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as "720p" | "1080p")}
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
        <label className="col-span-2 space-y-1">
          <span className="text-xs text-muted-foreground">Voiceover</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2"
            value={voiceProvider}
            onChange={(e) => setVoiceProvider(e.target.value as typeof voiceProvider)}
          >
            <option value="none">No voiceover</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="fish">Fish Audio</option>
          </select>
        </label>
        {voiceProvider !== "none" && (
          <label className="col-span-2 space-y-1">
            <span className="text-xs text-muted-foreground">Voice ID (optional, uses the server default)</span>
            <Input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} maxLength={100} />
          </label>
        )}
      </div>
      <Button onClick={() => void submit()} disabled={!canSave} className="w-full">
        {create.isPending ? <Loader2 className="animate-spin" /> : null} Create reel
      </Button>
    </div>
  );
}

function ReelEditor({ id }: { id: string }) {
  const { data: project, isLoading } = useVideoProject(id);
  const write = useWriteVideoScript();
  const render = useRenderVideoProject();

  if (isLoading || !project) {
    return <p className="text-sm text-muted-foreground">Loading reel…</p>;
  }

  const busy = project.status === "scripting" || write.isPending;
  const rendering = project.status === "editing" || render.isPending;
  const canWrite = ["draft", "scripted", "failed"].includes(project.status) && !busy && !rendering;
  const canRender = project.status === "scripted" && !rendering;

  const onWrite = async () => {
    try {
      await write.mutateAsync(project.id);
    } catch (err) {
      toast.error(errorText(err, "Could not start the script"));
    }
  };

  const onRender = async () => {
    try {
      await render.mutateAsync(project.id);
    } catch (err) {
      toast.error(errorText(err, "Could not start the render"));
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-sm font-semibold">{project.title}</h4>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[project.status] ?? project.status}</span>
        <span className="text-xs text-muted-foreground">
          {project.brief.durationSec}s · est. ${project.estimatedCostUsd.toFixed(2)}
        </span>
        <Button size="sm" className="ml-auto" onClick={() => void onWrite()} disabled={!canWrite}>
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {project.script ? "Rewrite script" : "Write script"}
        </Button>
        {project.status === "scripted" && (
          <Button size="sm" onClick={() => void onRender()} disabled={!canRender}>
            {rendering ? <Loader2 className="animate-spin" /> : null} Render reel
          </Button>
        )}
      </div>

      {project.status === "editing" && (
        <p className="text-sm text-muted-foreground">Rendering the reel. This can take a few minutes.</p>
      )}
      {project.outputUrl && (
        <video
          src={project.outputUrl}
          controls
          playsInline
          className="mx-auto max-h-[520px] rounded-lg bg-black"
        />
      )}

      {project.status === "scripting" && (
        <p className="text-sm text-muted-foreground">Writing the shot list. This takes about a minute.</p>
      )}
      {project.status === "failed" && project.errorMessage && (
        <p className="text-sm text-destructive">{project.errorMessage}</p>
      )}
      {project.complianceNotes.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <p className="font-medium">Brand rules to fix:</p>
          <ul className="list-disc pl-5">
            {project.complianceNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {project.script && project.status === "scripted" && (
        <ScriptEditor key={`${project.id}-${project.updatedAt}`} project={project} />
      )}
      {project.script && project.status !== "scripted" && <ScriptReadOnly script={project.script} />}
    </div>
  );
}

function ScriptReadOnly({ script }: { script: ReelScript }) {
  return (
    <ol className="space-y-2 text-sm">
      <li className="font-medium">{script.title}</li>
      {script.shots.map((s) => (
        <li key={s.id} className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">
            {s.startSec}s–{s.endSec}s · {s.kind.replace("_", " ")}
            {s.sourceFile ? ` · ${s.sourceFile}` : ""}
          </div>
          <div>{s.description}</div>
          {s.voiceover && <div className="italic">“{s.voiceover}”</div>}
          {s.onScreenText && <div className="text-xs">On screen: {s.onScreenText}</div>}
        </li>
      ))}
      <li className="text-muted-foreground">CTA: {script.cta}</li>
    </ol>
  );
}

function ScriptEditor({ project }: { project: VideoProjectDto }) {
  const save = useSaveVideoScript();
  const initial = project.script as ReelScript;
  const [draft, setDraft] = useState<ReelScript>(initial);
  useEffect(() => setDraft(initial), [initial]);

  const problems = useMemo(
    () => validateReelScript(draft, project.brief.durationSec),
    [draft, project.brief.durationSec],
  );

  const setShot = (index: number, patch: Partial<ReelShot>) =>
    setDraft((d) => ({ ...d, shots: d.shots.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));

  const onSave = async () => {
    try {
      await save.mutateAsync({ id: project.id, script: draft });
      toast.success("Script saved");
    } catch (err) {
      toast.error(errorText(err, "Could not save the script"));
    }
  };

  return (
    <div className="space-y-3">
      <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Title" />
      <ul className="space-y-2">
        {draft.shots.map((s, i) => (
          <li key={s.id} className="space-y-2 rounded-md border p-2 text-sm">
            <div className="grid grid-cols-4 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Start</span>
                <Input type="number" step="0.5" value={s.startSec} onChange={(e) => setShot(i, { startSec: Number(e.target.value) })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">End</span>
                <Input type="number" step="0.5" value={s.endSec} onChange={(e) => setShot(i, { endSec: Number(e.target.value) })} />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-xs text-muted-foreground">Kind</span>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2"
                  value={s.kind}
                  onChange={(e) => setShot(i, { kind: e.target.value as ReelShot["kind"] })}
                >
                  {REEL_SHOT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Textarea value={s.description} onChange={(e) => setShot(i, { description: e.target.value })} rows={2} aria-label={`Shot ${s.id} description`} />
            <Input value={s.voiceover ?? ""} placeholder="Voiceover (optional)" onChange={(e) => setShot(i, { voiceover: e.target.value || null })} />
            <Input value={s.onScreenText ?? ""} placeholder="On-screen text (optional)" onChange={(e) => setShot(i, { onScreenText: e.target.value || null })} />
            <Input value={s.sourceFile ?? ""} placeholder="Source file (footage shots)" onChange={(e) => setShot(i, { sourceFile: e.target.value || null })} />
          </li>
        ))}
      </ul>
      <Input value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} aria-label="Hook" placeholder="Hook" />
      <Input value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} aria-label="Call to action" placeholder="Call to action" />

      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <Button onClick={() => void onSave()} disabled={problems.length > 0 || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="animate-spin" /> : null} Save script
      </Button>
    </div>
  );
}
