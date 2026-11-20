"use client";

import type { ShortsChannelDto } from "@catgpt/types";
import { Badge } from "@/components/ui/badge";

/** YouTube connection status for a channel. The connect button is added with OAuth (phase 5). */
export function YoutubeConnect({ channel }: { channel: ShortsChannelDto }) {
  const yt = channel.youtube;
  if (yt.status === "connected") return <Badge variant="secondary">{yt.channelTitle ?? "Connected"}</Badge>;
  return <Badge variant="muted">Not connected: manual posting</Badge>;
}
