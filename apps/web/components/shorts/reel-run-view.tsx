"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Copy, Download, Loader2, Pencil, RefreshCw, Wand2 } from "lucide-react";
import { REEL_TEMPLATES, REEL_TYPE_LABELS, reelLanguage, type ReelDetailDto } from "@catgpt/types";
import { ShortsShell, fmtWhen } from "@/components/shorts/shorts-shell";
import { ReelPipelineSteps } from "@/components/shorts/reel-pipeline";
import { fmtDur, ReelSetupNotice } from "@/components/shorts/reel-studio-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useRegenerateReel, useReel, useRenderReel } from "@/lib/shorts-reel-hooks";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : fallback);
const usd = (x: number) => (x === 0 ? "$0.00" : x < 0.01 ? "< $0.01" : `$${x.toFixed(2)}`);
const mb = (b: number | null) => (b ? `${(b / 1024 / 1024).toFixed(1)} MB` : "-");

/**
 * One reel from the generator's point of view: live progress while the
 * background job runs (from the job's real status), then the finished video
 * with download, regenerate and edit.
 */
export function ReelRunView({ id }: { id: string }) {
  const { data, isLoading, error } = useReel(id);
  return (
    <ShortsShell current="reels">
      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : error || !data ? (
        <Card className="p-6 text-sm text-destructive">{errMsg(error, "Reel not found")}</Card>
      ) : (
        <Run reel={data} />
      )}
    </ShortsShell>
  );
}

function Run({ reel }: { reel: ReelDetailDto }) {
  const busy = reel.status === "queued" || reel.status === "rendering";
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/shorts/reels" aria-label="All reels">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold leading-tight">{reel.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{reel.mode === "brand" ? `Brand · ${reel.brandName ?? "deleted brand"}` : "General"}</Badge>
            {reel.reelType && <Badge variant="muted">{REEL_TYPE_LABELS[reel.reelType].label}</Badge>}
            <span>
              {reel.durationSec}s · {reelLanguage(reel.language).label} · created {fmtWhen(reel.createdAt)}
            </span>
          </div>
        </div>
      </div>
      <ReelSetupNotice />
      {busy ? <Generating reel={reel} /> : reel.status === "completed" && reel.fileUrl ? <Finished reel={reel} /> : <NotFinished reel={reel} />}
    </div>
  );
}

/* -------------------------------- progress -------------------------------- */

function Generating({ reel }: { reel: ReelDetailDto }) {
  return (
    <Card className="mx-auto max-w-xl space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Loader2 className="h-6 w-6 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{reel.status === "queued" ? "Waiting for a worker" : "Generating your reel"}</div>
          <p className="truncate text-sm text-muted-foreground" title={reel.stage ?? undefined}>
            {reel.stage ?? "Starting"}
          </p>
        </div>
        <span className="text-2xl font-semibold tabular-nums">{reel.progress}%</span>
      </div>
      <Progress value={reel.progress} />
      <ReelPipelineSteps reel={reel} />
      <p className="text-xs text-muted-foreground">
        Everything runs on the server, so you can leave this page and come back. A 30-second reel usually takes a few minutes.
        {reel.costUsd > 0 && <> Spent so far: {usd(reel.costUsd)}.</>}
      </p>
    </Card>
  );
}

/* -------------------------------- finished -------------------------------- */

function Finished({ reel }: { reel: ReelDetailDto }) {
  const regen = useRegenerateReel(reel.id);
  const [asking, setAsking] = useState(false);
  const [direction, setDirection] = useState("");
  const script = reel.script;
  const stale = reel.completedAt && new Date(reel.updatedAt).getTime() - new Date(reel.completedAt).getTime() > 2000;
  const caption = script ? `${script.caption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}`.trim() : "";
  const s = reel.settings;

  const regenerate = () =>
    regen.mutate(direction, {
      onSuccess: () => {
        setAsking(false);
        setDirection("");
        toast.info("Regenerating: new script, visuals, voice and edit.");
      },
      onError: (e) => toast.error(errMsg(e, "Could not regenerate")),
    });

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <Card className="mx-auto w-full max-w-[360px] overflow-hidden p-0 md:max-w-none">
        <video key={reel.fileUrl} src={reel.fileUrl!} poster={reel.thumbUrl ?? undefined} controls playsInline className="aspect-[9/16] w-full bg-black" />
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">Ready to publish</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Fact label="Duration" value={fmtDur(reel.videoDurationSec)} />
            <Fact label="Resolution" value={reel.width && reel.height ? `${reel.width}×${reel.height}` : "-"} />
            <Fact label="File size" value={mb(reel.fileSizeBytes)} />
            <Fact label="Style" value={REEL_TEMPLATES[s.template].label} />
            <Fact label="Voice" value={s.voiceEnabled ? `${s.voiceGender === "male" ? "Male" : "Female"}${s.voiceStyle ? ` · ${s.voiceStyle}` : ""}` : "Off"} />
            <Fact label="AI cost" value={usd(reel.costUsd)} />
          </dl>
          {stale && <p className="text-xs text-amber-600">You edited this reel after the last render; open Edit and render again to include the changes.</p>}
          <div className="flex flex-wrap gap-2">
            {reel.downloadUrl && (
              <Button asChild>
                <a href={reel.downloadUrl}>
                  <Download className="h-4 w-4" /> Download MP4
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setAsking((v) => !v)} disabled={regen.isPending}>
              <RefreshCw className="h-4 w-4" /> Regenerate
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/shorts/reels/${reel.id}?edit=1`}>
                <Pencil className="h-4 w-4" /> Edit video
              </Link>
            </Button>
          </div>
          {asking && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Makes a fresh version of this brief: new script, visuals, voice and edit. To fix only a scene, the text or the music, use Edit video instead: it keeps everything else.
              </p>
              <div className="flex gap-2">
                <Input
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="Optional: what should be different? e.g. funnier hook, more product shots"
                  maxLength={600}
                  className="h-9"
                />
                <Button onClick={regenerate} disabled={regen.isPending}>
                  {regen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Go
                </Button>
              </div>
            </div>
          )}
        </Card>

        {caption && (
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Post caption</h3>
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(caption).then(() => toast.success("Caption copied"))}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{caption}</p>
          </Card>
        )}

        {script && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Scenes</h3>
            <ol className="space-y-1.5 text-sm">
              {script.scenes.map((sc, i) => (
                <li key={sc.id} className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {sc.onScreenText && <span className="font-medium">{sc.onScreenText} · </span>}
                    <span className="text-muted-foreground">{sc.narration || "(no narration)"}</span>
                  </span>
                  {sc.resolved && (
                    <Badge variant="muted" className="h-fit shrink-0 text-[10px]" title={sc.resolved.note ?? undefined}>
                      {SOURCE_SHORT[sc.resolved.source] ?? sc.resolved.source}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}

        <RunDetails reel={reel} />
      </div>
    </div>
  );
}

const SOURCE_SHORT: Record<string, string> = {
  brand_image: "Product photo",
  stock_video: "Stock video",
  stock_image: "Stock photo",
  ai_image: "AI image",
  ai_video: "AI clip",
  upload: "Upload",
  graphic: "Graphic",
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

/** Notes from the render and the tracked spend, folded away. */
function RunDetails({ reel }: { reel: ReelDetailDto }) {
  if (!reel.warnings.length && !reel.costLog.length) return null;
  return (
    <div className="space-y-2">
      {reel.warnings.length > 0 && (
        <details className="rounded-md border bg-muted/30 p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {reel.warnings.length} note{reel.warnings.length === 1 ? "" : "s"} from the render
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {reel.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {reel.costLog.length > 0 && (
        <details className="rounded-md border bg-muted/30 p-2 text-xs">
          <summary className="flex cursor-pointer justify-between text-muted-foreground">
            <span>AI spend for this reel ({reel.costLog.length} paid calls)</span>
            <span className="font-medium tabular-nums text-foreground">{usd(reel.costUsd)}</span>
          </summary>
          <ul className="mt-2 space-y-0.5">
            {reel.costLog.map((c, i) => (
              <li key={`${c.at}-${i}`} className="flex justify-between gap-2">
                <span>
                  {c.label} <span className="text-muted-foreground">· run {c.run}</span>
                </span>
                <span className="tabular-nums">{usd(c.usd)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">List price × actual usage. Stock media, editing, subtitles and music are free.</p>
        </details>
      )}
    </div>
  );
}

/* ------------------------- failed / script-only state ------------------------ */

function NotFinished({ reel }: { reel: ReelDetailDto }) {
  const render = useRenderReel(reel.id);
  const failed = reel.status === "failed";
  return (
    <Card className="mx-auto max-w-xl space-y-4 p-5">
      {failed ? (
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="font-semibold text-destructive">Generation stopped</div>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">{reel.error}</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="font-semibold">Script ready</div>
          <p className="text-sm text-muted-foreground">{reel.error ?? "Review it in the editor, or generate the video now."}</p>
        </div>
      )}
      {failed && <ReelPipelineSteps reel={reel} />}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            render.mutate(undefined, {
              onError: (e) => toast.error(errMsg(e, "Could not start")),
            })
          }
          disabled={render.isPending}
        >
          {render.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {failed ? "Try again" : "Generate video"}
        </Button>
        {reel.script && (
          <Button variant="outline" asChild>
            <Link href={`/shorts/reels/${reel.id}?edit=1`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Try again resumes from what already worked: the script, voiceovers and visuals that were made are reused.</p>
      <RunDetails reel={reel} />
    </Card>
  );
}
