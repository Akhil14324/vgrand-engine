"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PENDING_JOIN_KEY } from "@/lib/config";
import { Button } from "@/components/ui/button";

interface Preview {
  workspaceId: string;
  workspaceName: string;
  ownerName: string;
  alreadyMember: boolean;
}

/** Landing page for a workspace invite link. */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Sign in (or sign up) first; the studio sends them back here afterwards.
      try {
        localStorage.setItem(PENDING_JOIN_KEY, token);
      } catch {
        // private mode: they can simply open the link again after signing in
      }
      router.replace("/login");
      return;
    }
    apiFetch<Preview>(`/join/${token}`)
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [loading, user, token, router]);

  const join = async () => {
    setJoining(true);
    try {
      await apiFetch(`/join/${token}`, { method: "POST" });
      router.replace("/workspaces");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join");
      setJoining(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <Users className="h-8 w-8 text-primary" />
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Invite unavailable</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="secondary" onClick={() => router.replace("/")}>
              Go to CatGPT
            </Button>
          </>
        ) : !preview ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <h1 className="text-lg font-semibold">Join “{preview.workspaceName}”</h1>
            <p className="text-sm text-muted-foreground">
              {preview.ownerName} invited you to this shared workspace: team chat with CatGPT,
              shared documents and brands.
            </p>
            {preview.alreadyMember ? (
              <Button onClick={() => router.replace("/workspaces")}>Open workspace</Button>
            ) : (
              <Button onClick={join} disabled={joining}>
                {joining && <Loader2 className="animate-spin" />} Join workspace
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
