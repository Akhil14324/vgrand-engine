"use client";

import { useState } from "react";
import { Film } from "lucide-react";
import type { GuavaConfidence, GuavaContentAuditDto, GuavaContentReport, GuavaReelInsight, GuavaSignalSplit } from "@catgpt/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The review laid out the way a teammate would say it: what works, what loses
 * people, what to do next. Every finding points at the videos it stands on.
 */

const CONF_LABEL: Record<GuavaConfidence | "too_close", string> = { sure: "Sure", i_think: "I think", too_close: "Too close to call" };
const CONF_CLASS: Record<GuavaConfidence | "too_close", string> = {
  sure: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  i_think: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  too_close: "bg-muted text-muted-foreground",
};

function Confidence({ value }: { value: GuavaConfidence | "too_close" }) {
  return <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", CONF_CLASS[value])}>{CONF_LABEL[value]}</span>;
}

function Thumb({ reel }: { reel: GuavaReelInsight }) {
  const [broken, setBroken] = useState(false);
  const inner =
    !reel.thumbnailUrl || broken ? (
      <div className="flex h-16 w-10 items-center justify-center rounded bg-muted">
        <Film className="h-4 w-4 text-muted-foreground" />
      </div>
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={reel.thumbnailUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-16 w-10 rounded object-cover"
      />
    );
  return reel.permalink ? (
    <a href={reel.permalink} target="_blank" rel="noreferrer" title={reel.caption || "Open on Instagram"} className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}

function PostStrip({ ids, audit }: { ids: string[]; audit: GuavaContentAuditDto }) {
  const reels = ids.flatMap((id) => audit.reels.find((r) => r.mediaId === id) ?? []);
  if (!reels.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="The videos this stands on">
      {reels.map((r) => (
        <Thumb key={r.mediaId} reel={r} />
      ))}
    </div>
  );
}

function Findings({
  title,
  intro,
  items,
  audit,
  tone,
}: {
  title: string;
  intro: string;
  items: GuavaContentReport["whatWorks"];
  audit: GuavaContentAuditDto;
  tone: "good" | "bad";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={cn("text-base", tone === "good" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{intro}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length ? (
          items.map((f, i) => (
            <div key={i} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{f.title}</h3>
                <Confidence value={f.confidence} />
              </div>
              <p className="mt-1 text-muted-foreground">{f.detail}</p>
              <PostStrip ids={f.mediaIds} audit={audit} />
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nothing clear enough to say yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SplitsTable({ splits }: { splits: GuavaSignalSplit[] }) {
  if (!splits.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">The splits no dashboard shows</CardTitle>
        <p className="text-xs text-muted-foreground">
          Typical likes + comments of your posts with vs without each thing seen in the video. Typical = the middle post, so one viral post
          doesn&apos;t decide it; spikes are left out.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">In the video</th>
              <th className="py-2 pr-3 font-medium">With</th>
              <th className="py-2 pr-3 font-medium">Without</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => (
              <tr key={s.key} className="border-b align-top last:border-0">
                <td className="py-2 pr-3">{s.withLabel}</td>
                <td className={cn("py-2 pr-3 tabular-nums", s.withTypical > s.withoutTypical && s.confidence !== "too_close" && "font-semibold")}>
                  {s.withTypical.toLocaleString()} <span className="text-xs text-muted-foreground">({s.withCount} posts)</span>
                </td>
                <td className={cn("py-2 pr-3 tabular-nums", s.withoutTypical > s.withTypical && s.confidence !== "too_close" && "font-semibold")}>
                  {s.withoutTypical.toLocaleString()} <span className="text-xs text-muted-foreground">({s.withoutCount} posts)</span>
                </td>
                <td className="py-2 text-right">
                  <Confidence value={s.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function List({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <div className="text-sm">
      <div className={cn("font-medium", className)}>{title}</div>
      {items.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">–</p>
      )}
    </div>
  );
}

export function ReviewRead({ audit }: { audit: GuavaContentAuditDto }) {
  const r = audit.report!;
  const next = r.doNext;
  const watched = audit.reels.filter((x) => x.isOwn);
  const fromVideo = watched.filter((x) => x.analysedFrom === "video").length;
  const ownTypical = audit.typical.find((t) => t.isOwn);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Watched {fromVideo} of your {watched.length} newest posts as video
        {ownTypical?.typical !== null && ownTypical?.typical !== undefined ? ` · your typical post: ${ownTypical.typical.toLocaleString()} likes + comments` : ""}
        . Likes and comments only: Instagram doesn&apos;t share views or reach for this connection.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Findings title="What works" intro="Each one stands on the videos shown under it." items={r.whatWorks} audit={audit} tone="good" />
        <Findings
          title="What loses people"
          intro="The openings, still shots and lengths that cost you, read off the footage itself."
          items={r.whatLosesPeople}
          audit={audit}
          tone="bad"
        />
      </div>

      <CommentsRead audit={audit} />

      <SplitsTable splits={audit.splits} />

      {r.tooCloseToCall.length > 0 && (
        <Card className="p-4 text-sm">
          <div className="font-medium">Too close to call</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {r.tooCloseToCall.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Card>
      )}

      {audit.spikes.length > 0 && (
        <Card className="p-4 text-sm">
          <div className="font-medium">Spikes, not counted as &quot;working&quot;</div>
          <p className="text-xs text-muted-foreground">Far above that account&apos;s typical post: a one-off, or possibly boosted.</p>
          <ul className="mt-2 space-y-2">
            {audit.spikes.map((s) => {
              const reel = audit.reels.find((x) => x.mediaId === s.mediaId);
              return (
                <li key={s.mediaId} className="flex items-center gap-2">
                  {reel && <Thumb reel={reel} />}
                  <span>
                    @{s.handle}: {s.timesTypical}× their typical post
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What to do next</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <List title="Keep" items={next.keep} className="text-emerald-700 dark:text-emerald-400" />
            <List title="Start" items={next.start} className="text-primary" />
            <List title="Stop" items={next.stop} className="text-destructive" />
          </div>
          {next.nextVideos.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">The next {next.nextVideos.length} videos I&apos;d make</div>
              <div className="grid gap-3 md:grid-cols-3">
                {next.nextVideos.map((v, i) => (
                  <div key={i} className="rounded-lg border p-3 text-sm">
                    <h3 className="font-semibold">
                      {i + 1}. {v.title}
                    </h3>
                    {v.hook && (
                      <p className="mt-1">
                        <span className="font-medium">First 2 seconds: </span>
                        {v.hook}
                      </p>
                    )}
                    {v.scenes.length > 0 && (
                      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                        {v.scenes.map((sc, j) => (
                          <li key={j}>{sc}</li>
                        ))}
                      </ol>
                    )}
                    {v.cta && <p className="mt-1 text-muted-foreground">CTA: {v.cta}</p>}
                    {v.why && <p className="mt-1 text-xs text-muted-foreground">Why: {v.why}</p>}
                    {v.basedOn.length > 0 && (
                      <>
                        <div className="mt-2 text-[11px] text-muted-foreground">Comes from</div>
                        <PostStrip ids={v.basedOn} audit={audit} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CommentsRead({ audit }: { audit: GuavaContentAuditDto }) {
  const c = audit.report!.comments;
  const ownComments = audit.reels.filter((r) => r.isOwn).reduce((n, r) => n + (r.comments ?? 0), 0);
  if (!audit.commentsRead) {
    if (!ownComments) return null;
    return (
      <Card className="p-4 text-sm">
        <div className="font-medium">What your comments say</div>
        <p className="mt-1 text-muted-foreground">
          Your posts have {ownComments.toLocaleString()} comments, but Instagram didn&apos;t let us read them. Reconnect Instagram with the
          comment permission (the same one Automations uses) and review again.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">What your comments say</CardTitle>
        <p className="text-xs text-muted-foreground">Read {audit.commentsRead.toLocaleString()} comments on your newest posts.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {c.summary && <p className="text-sm">{c.summary}</p>}
        <div className="grid gap-4 md:grid-cols-3">
          <List title="People ask for" items={c.asks} className="text-primary" />
          <List title="Praise" items={c.praise} className="text-emerald-700 dark:text-emerald-400" />
          <List title="Complaints" items={c.complaints} className="text-destructive" />
        </div>
        <List title="Reply or make a video about" items={c.replyIdeas} />
      </CardContent>
    </Card>
  );
}

/** Rival block: what is travelling for them, take, leave, the gap. Empty for old reviews. */
export function RivalRead({ competitor: c, typical }: { competitor: GuavaContentReport["competitors"][number]; typical: number | null }) {
  if (!c.travelling && !c.take.length && !c.leave.length && !c.gap) return null;
  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-3 text-sm">
      {c.travelling && (
        <p>
          <span className="font-medium">What&apos;s travelling for them: </span>
          {c.travelling}
          {typical !== null && <span className="text-muted-foreground"> (vs their typical post: {typical.toLocaleString()} likes + comments)</span>}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <List title="Take" items={c.take} className="text-emerald-700 dark:text-emerald-400" />
        <List title="Leave" items={c.leave} className="text-destructive" />
      </div>
      {c.gap && (
        <p>
          <span className="font-medium">The gap: </span>
          {c.gap}
        </p>
      )}
    </div>
  );
}

