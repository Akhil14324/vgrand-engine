"use client";

import { useAuth } from "@/lib/auth";
import { StudioShell } from "@/components/studio-shell";
import { LandingPage } from "@/components/landing-page";

/**
 * "/" for everyone: signed-in users go straight into the studio, visitors get
 * the landing page (its Get Started / Sign in lead to /login).
 */
export function HomeGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#050505]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/catgpt-paw.png" alt="CatGPT" className="h-12 w-auto animate-pulse" />
      </div>
    );
  }
  return user ? <StudioShell /> : <LandingPage />;
}
