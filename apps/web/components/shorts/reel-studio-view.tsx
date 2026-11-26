"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, Download, Eye, Film, Loader2, Play, Sparkles, Trash2, Wand2 } from "lucide-react";
import {
  defaultReelSettings,
  estimateReelCost,
  plannedReelCostInput,
  REEL_DURATIONS,
  REEL_LANGUAGES,
  REEL_TEMPLATE_KEYS,
  REEL_TEMPLATES,
  REEL_TYPE_LABELS,
  type ReelDto,
  type ReelLanguage,
  type ReelStyle,
} from "@catgpt/types";
import { ShortsShell, fmtWhen } from "@/components/shorts/shorts-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useBrands } from "@/lib/hooks";
import { ReelCostEstimateView } from "@/components/shorts/reel-pipeline";
import { useCreateReel, useDeleteReel, useReelOptions, useReels } from "@/lib/shorts-reel-hooks";
import { cn } from "@/lib/utils";

export function ReelStudioView() {
  return (
    <ShortsShell current="reels">
      <div className="space-y-6">
        <ReelSetupNotice />
        <GeneratorForm />
        <Dashboard />
      </div>
    </ShortsShell>
  );
}

/* ------------------------------- setup notice ------------------------------ */

export function ReelSetupNotice() {
  const { data } = useReelOptions();
  if (!data) return null;
  const f = data.features;
  const missing: string[] = [];
  if (!f.script) missing.push("an AI writer (ANTHROPIC_API_KEY + ANTHROPIC_MODEL, OPENAI_API_KEY or GOOGLE_AI_API_KEY)");
  if (!f.voice.elevenlabs && !f.voice.openai) missing.push("a voice (ELEVENLABS_API_KEY or OPENAI_API_KEY) — reels can still render with music + subtitles only");
  if (!f.ffmpeg) missing.push("ffmpeg/ffprobe on the server");
  const notes: string[] = [];
  if (!f.stockVideo) notes.push("No stock footage keys (PEXELS_API_KEY / PIXABAY_API_KEY): scenes use AI images, brand photos or brand graphic cards.");
  if (!f.aiImage) notes.push("AI images need OPENAI_API_KEY.");
  if (!f.aiVideo) notes.push("AI video clips need VIDEO_GEN_PROVIDER, VIDEO_GEN_API_KEY and PATH_C_MONTHLY_BUDGET.");
  if (!missing.length && !notes.length) return null;
  return (
    <div className={cn("rounded-lg border p-3 text-sm", missing.length ? "border-amber-500/50 bg-amber-500/10" : "bg-muted/40")}>
      {missing.length > 0 && (
        <div className="mb-1 flex items-start gap-2 font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>Reel Studio needs {missing.join("; ")}.</span>
        </div>
      )}
      {notes.map((n) => (
        <p key={n} className="text-xs text-muted-foreground">
          {n}
        </p>
      ))}
    </div>
  );
}

/* --------------------------------- dashboard -------------------------------- */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "brand", label: "Brand reels" },
  { key: "general", label: "General reels" },
  { key: "processing", label: "Processing" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "draft", label: "Scripts" },
] as const;

function Dashboard() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const q = filter === "brand" || filter === "general" ? { mode: filter } : filter === "all" ? {} : { status: filter };
  const { data, isLoading } = useReels(q);
  const all = useReels({});
  const [preview, setPreview] = useState<ReelDto | null>(null);

  const stats = useMemo(() => {
    const items = all.data ?? [];
    return {
      total: items.length,
      brand: items.filter((r) => r.mode === "brand").length,
      general: items.filter((r) => r.mode === "general").length,
      processing: items.filter((r) => r.status === "queued" || r.status === "rendering").length,
      completed: items.filter((r) => r.status === "completed").length,
      failed: items.filter((r) => r.status === "failed").length,
    };
  }, [all.data]);

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg font-semibold">Your reels</h3>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {(
          [
            ["Total", stats.total],
            ["Brand", stats.brand],
            ["General", stats.general],
            ["Processing", stats.processing],
            ["Completed", stats.completed],
            ["Failed", stats.failed],
          ] as const
        ).map(([label, n]) => (
          <Card key={label} className="p-2.5 text-center">
            <div className="text-lg font-semibold tabular-nums">{n}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </Card>
        ))}
      </div>

      <div className="flex max-w-full gap-1 overflow-x-auto rounded-md border p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "whitespace-nowrap rounded px-2.5 py-1 text-sm",
              filter === f.key ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16] w-full" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Film className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{filter === "all" ? "No reels yet. Describe one above and click Generate Reel." : "Nothing here."}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((r) => (
            <ReelCard key={r.id} reel={r} onPreview={() => setPreview(r)} />
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{preview?.title}</DialogTitle>
          </DialogHeader>
          {preview?.fileUrl && (
            <video src={preview.fileUrl} controls autoPlay playsInline className="aspect-[9/16] w-full rounded-md bg-black" />
          )}
          {preview?.downloadUrl && (
            <Button asChild>
              <a href={preview.downloadUrl}>
                <Download className="h-4 w-4" /> Download MP4
              </a>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  script_ready: "Script ready",
  queued: "Queued",
  rendering: "Rendering",
  completed: "Completed",
  failed: "Failed",
};

export const fmtDur = (s: number | null | undefined) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "-");

function ReelCard({ reel, onPreview }: { reel: ReelDto; onPreview: () => void }) {
  const del = useDeleteReel();
  const busy = reel.status === "queued" || reel.status === "rendering";
  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <button
        type="button"
        onClick={reel.fileUrl ? onPreview : undefined}
        className={cn("group relative aspect-[9/16] w-full bg-muted", reel.fileUrl && "cursor-pointer")}
        aria-label={reel.fileUrl ? `Preview ${reel.title}` : reel.title}
      >
        {reel.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reel.thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : reel.status === "failed" ? <AlertTriangle className="h-6 w-6 text-destructive" /> : <Film className="h-6 w-6" />}
            <span className="line-clamp-4">{busy ? reel.stage ?? "Working" : reel.title}</span>
          </div>
        )}
        {reel.fileUrl && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
            <Play className="h-10 w-10 text-white" />
          </span>
        )}
        <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          <Badge variant="secondary" className="bg-background/85 text-[10px]">
            {reel.mode === "brand" ? (reel.brandName ?? "Brand") : "General"}
          </Badge>
        </span>
        {reel.videoDurationSec && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{fmtDur(reel.videoDurationSec)}</span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{reel.title}</div>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span className={cn(reel.status === "failed" && "text-destructive", reel.status === "completed" && "text-emerald-600")}>{STATUS_LABEL[reel.status] ?? reel.status}</span>
          <span>·</span>
          <span>{reel.durationSec}s target</span>
          <span>·</span>
          <span>{fmtWhen(reel.createdAt)}</span>
        </div>
        {reel.reelType && <div className="text-[11px] text-muted-foreground">{REEL_TYPE_LABELS[reel.reelType].label}</div>}
        {busy && <Progress value={reel.progress} />}
        {reel.status === "failed" && reel.error && <p className="line-clamp-2 text-[11px] text-destructive">{reel.error}</p>}
        <div className="mt-auto flex gap-1 pt-1">
          <Button asChild size="sm" variant="outline" className="flex-1">
            <Link href={`/shorts/reels/${reel.id}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {busy ? "Progress" : "Open"}
            </Link>
          </Button>
          {reel.downloadUrl && (
            <Button asChild size="sm" variant="outline" aria-label="Download">
              <a href={reel.downloadUrl}>
                <Download className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Delete"
            disabled={del.isPending}
            onClick={() => {
              if (confirm(`Delete "${reel.title}"? Its video and files are removed.`)) {
                del.mutate(reel.id, { onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed") });
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------- generator -------------------------------- */

const TOPIC_IDEAS = [
  "Morning habits of successful people",
  "5 mind-blowing space facts",
  "Simple business ideas you can start this month",
  "Quick 10-minute home workout",
  "Easy 3-ingredient breakfast recipes",
  "Hidden travel gems in South India",
];

const STYLE_OPTIONS: { key: ReelStyle; label: string }[] = [
  { key: "auto", label: "Auto (AI picks)" },
  ...REEL_TEMPLATE_KEYS.map((k) => ({ key: k, label: REEL_TEMPLATES[k].label })),
];

/**
 * The one autonomous generator: brand or general, topic, duration, language,
 * voice and an optional style. "Generate Reel" queues a single background job
 * that writes the script, plans scenes, finds visuals, voices, subtitles,
 * edits and renders the MP4.
 */
function GeneratorForm() {
  const router = useRouter();
  const brands = useBrands();
  const create = useCreateReel();
  const { data: opts } = useReelOptions();
  const [mode, setMode] = useState<"general" | "brand">("general");
  const [brandId, setBrandId] = useState("");
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState<15 | 30 | 45 | 60>(30);
  const [language, setLanguage] = useState<ReelLanguage>("en");
  const [voice, setVoice] = useState<"auto" | "female" | "male">("auto");
  const [style, setStyle] = useState<ReelStyle>("auto");

  const brand = brands.data?.find((b) => b.id === brandId) ?? null;
  const products = brand?.assets.filter((a) => a.kind === "product") ?? [];
  const canGenerate = mode === "brand" ? !!brandId : topic.trim().length >= 2;

  const estimate = opts
    ? estimateReelCost({
        scenes: plannedReelCostInput(duration, language),
        settings: defaultReelSettings(),
        features: { ...opts.features, elevenlabs: opts.features.voice.elevenlabs, openai: opts.features.voice.openai },
        includeScript: true,
        aiVideoPerSecUsd: opts.aiVideoPerSecUsd,
      })
    : null;

  const generate = () => {
    if (!canGenerate) return;
    create.mutate(
      {
        mode,
        brandId: mode === "brand" ? brandId : null,
        reelType: null,
        topic: topic.trim(),
        durationSec: duration,
        language,
        productUrl: null,
        voice,
        style,
        autoRender: true,
      },
      {
        onSuccess: (r) => router.push(`/shorts/reels/${r.id}`),
        onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Could not start the reel"),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold">Generate a reel</h2>
          <p className="text-sm text-muted-foreground">Describe it and click Generate. Script, visuals, voiceover, subtitles, music and editing all happen automatically.</p>
        </div>
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Content type">
          {(
            [
              ["general", "General content", Sparkles],
              ["brand", "Brand", Building2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-sm", mode === key ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "brand" && (
        <Field label="Brand">
          {brands.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : !brands.data?.length ? (
            <p className="text-sm text-muted-foreground">
              You have no brands yet. <Link href="/brand" className="text-primary underline">Create a brand</Link> first (logo, colours and product photos make reels much better).
            </p>
          ) : (
            <>
              <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">Choose a brand…</option>
                {brands.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              {brand && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {brand.assets.find((a) => a.kind === "logo") ? <Badge variant="muted">Logo ✓</Badge> : <Badge variant="outline">No logo</Badge>}
                  {(brand.profile.colors ?? []).map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full border" style={{ background: c }} title={c} />
                  ))}
                  <Badge variant="muted">
                    {products.length} product photo{products.length === 1 ? "" : "s"}
                  </Badge>
                  {brand.profile.offer && <Badge variant="muted">Offer on file</Badge>}
                </div>
              )}
            </>
          )}
        </Field>
      )}

      <Field label={mode === "brand" ? "What should the reel be about? (optional: product, offer, festival, audience…)" : "Topic, idea or description"}>
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={mode === "brand" ? "e.g. Launch of our new mango flavour for college students, playful tone" : "e.g. 5 habits that will change your mornings"}
        />
        {mode === "general" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TOPIC_IDEAS.map((t) => (
              <button key={t} type="button" onClick={() => setTopic(t)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                {t}
              </button>
            ))}
          </div>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Duration">
          <div className="flex gap-1">
            {REEL_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={cn("flex-1 rounded-md border py-1.5 text-sm", duration === d ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted")}
              >
                {d}s
              </button>
            ))}
          </div>
        </Field>
        <Field label="Language">
          <Select value={language} onChange={(e) => setLanguage(e.target.value as ReelLanguage)}>
            {REEL_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Voice">
          <Select value={voice} onChange={(e) => setVoice(e.target.value as "auto" | "female" | "male")}>
            <option value="auto">Auto (AI picks)</option>
            <option value="female">Female voice</option>
            <option value="male">Male voice</option>
          </Select>
        </Field>
        <Field label="Style (optional)">
          <Select value={style} onChange={(e) => setStyle(e.target.value as ReelStyle)}>
            {STYLE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {estimate && (
          <div className="mr-auto min-w-[240px] flex-1">
            <ReelCostEstimateView estimate={estimate} title="Estimated cost" />
          </div>
        )}
        <Button size="lg" onClick={generate} disabled={!canGenerate || create.isPending}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Generate Reel
        </Button>
      </div>
    </Card>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
