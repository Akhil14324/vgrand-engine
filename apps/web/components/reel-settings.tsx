"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { VIDEO_MAX_MONTHLY_CAP_USD, videoSettingsSchema } from "@catgpt/types";
import { ApiRequestError } from "@/lib/api";
import { useSaveVideoSettings, useVideoSettings } from "@/lib/video-hooks";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Monthly video budget and the reel autopilot switch. The autopilot only makes
 * reels for you while a cap is set; it never posts without your approval.
 */
export function ReelSettingsPanel() {
  const settings = useVideoSettings();
  const save = useSaveVideoSettings();
  const [capText, setCapText] = useState("");
  const [autopilot, setAutopilot] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setCapText(settings.data.monthlyCapUsd === null ? "" : String(settings.data.monthlyCapUsd));
    setAutopilot(settings.data.autopilotEnabled);
  }, [settings.data]);

  const trimmed = capText.trim();
  const cap = trimmed === "" ? null : Number(trimmed);
  const draft = { monthlyCapUsd: cap, autopilotEnabled: autopilot };
  const check = videoSettingsSchema.safeParse(draft);
  const problem = check.success ? null : check.error.issues[0]!.message;

  const onSave = async () => {
    if (!check.success) return;
    try {
      await save.mutateAsync(check.data);
      toast.success("Video settings saved");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not save the settings");
    }
  };

  if (settings.isLoading) return <p className="text-sm text-muted-foreground">Loading settings…</p>;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <h3 className="font-display text-sm font-semibold">Video settings</h3>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Monthly video budget in USD (empty = no cap)</span>
        <Input
          inputMode="decimal"
          value={capText}
          onChange={(e) => setCapText(e.target.value)}
          placeholder="e.g. 25"
          aria-invalid={cap !== null && Number.isNaN(cap)}
        />
        <span className="block text-xs text-muted-foreground">Max ${VIDEO_MAX_MONTHLY_CAP_USD.toLocaleString()}.</span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={autopilot}
          onChange={(e) => setAutopilot(e.target.checked)}
        />
        <span>
          <span className="font-medium">Autopilot</span>
          <span className="block text-xs text-muted-foreground">
            Make planned reels a day ahead, within the budget above. You still approve each one before it posts.
          </span>
        </span>
      </label>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <Button size="sm" onClick={() => void onSave()} disabled={!check.success || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="animate-spin" /> : null} Save settings
      </Button>
    </div>
  );
}
