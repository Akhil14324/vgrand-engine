"use client";

import type { ShortsChannelDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useShortsHealth, useShortsRefresh } from "@/lib/shorts-hooks";

/** Per-channel YouTube connection: status, Connect / Reconnect / Disconnect. */
export function YoutubeConnect({ channel }: { channel: ShortsChannelDto }) {
  const health = useShortsHealth();
  const refresh = useShortsRefresh();
  const yt = channel.youtube;
  const oauth = health.data?.features.youtubeOAuth ?? false;

  const connect = async () => {
    try {
      const { url } = await apiFetch<{ url: string }>(`/shorts/channels/${channel.id}/youtube/connect`, { method: "POST" });
      window.location.href = url; // full redirect: Google sends the owner back to /shorts
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not start the YouTube connection");
    }
  };
  const disconnect = async () => {
    if (!window.confirm(`Disconnect YouTube from ${channel.displayName}? Its videos will go to the manual queue.`)) return;
    await apiFetch(`/shorts/channels/${channel.id}/youtube/disconnect`, { method: "POST" });
    refresh();
  };

  if (!oauth) return <Badge variant="muted" title="Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY">Manual posting (OAuth off)</Badge>;
  if (yt.status === "connected") {
    return (
      <span className="flex items-center gap-1.5">
        <Badge variant="secondary">{yt.channelTitle ?? "Connected"}</Badge>
        <Button size="sm" variant="ghost" onClick={disconnect}>
          Disconnect
        </Button>
      </span>
    );
  }
  if (yt.status === "reauth_required") {
    return (
      <span className="flex items-center gap-1.5" title={yt.reason ?? undefined}>
        <Badge variant="destructive">Reconnect needed</Badge>
        <Button size="sm" onClick={connect}>
          Reconnect
        </Button>
      </span>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={connect}>
      Connect YouTube
    </Button>
  );
}
