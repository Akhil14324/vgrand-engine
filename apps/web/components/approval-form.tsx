"use client";

import { useState } from "react";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import type { ApprovalLinkDto, ApprovalStatus } from "@catgpt/types";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ApprovalForm({
  token,
  initialStatus,
  initialReviewer,
  initialComment,
}: {
  token: string;
  initialStatus: ApprovalStatus;
  initialReviewer: string | null;
  initialComment: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [reviewer, setReviewer] = useState(initialReviewer ?? "");
  const [comment, setComment] = useState(initialComment ?? "");
  const [pending, setPending] = useState<"approve" | "request_changes" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const respond = (action: "approve" | "request_changes") => {
    setError(null);
    if (action === "request_changes" && !comment.trim()) {
      setError("Add a short note describing the requested change.");
      return;
    }
    setPending(action);
    void apiFetch<ApprovalLinkDto>(`/approvals/${token}/respond`, {
      method: "POST",
      json: {
        action,
        reviewerName: reviewer.trim() || undefined,
        comment: comment.trim() || undefined,
      },
    })
      .then((res) => setStatus(res.status))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not respond"))
      .finally(() => setPending(null));
  };

  return (
    <div className="mt-4 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Client decision</p>
        <span className="rounded-full border px-2 py-0.5 text-[11px] capitalize">
          {status.replaceAll("_", " ")}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder="Your name (optional)"
        />
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Approval note or requested changes"
          className="min-h-[38px] sm:col-span-2"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => respond("approve")}
          disabled={pending !== null}
        >
          {pending === "approve" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Check />
          )}
          Approve
        </Button>
        <Button
          variant="outline"
          onClick={() => respond("request_changes")}
          disabled={pending !== null}
        >
          {pending === "request_changes" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <MessageSquareWarning />
          )}
          Request changes
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
