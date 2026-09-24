"use client";

import { useEffect, useRef, useState } from "react";

const SPLASH_KEY = "catgpt:splash-played";

/**
 * Opening splash — plays the launch video once per fresh app open (new tab or
 * PWA launch). sessionStorage survives page refreshes but clears when the tab
 * closes, so reloads skip straight to the app.
 *
 * Renders nothing until the effect decides — server and client output stay
 * identical (no hydration mismatch, no flash on refresh).
 */
export function Splash() {
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (sessionStorage.getItem(SPLASH_KEY)) return;
    sessionStorage.setItem(SPLASH_KEY, "1");
    setReady(true);
  }, []);

  // If the video never starts (autoplay blocked / decode error), don't trap
  // the user — bail out shortly after it should have begun.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (!started.current) setFading(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setGone(true), 500);
    return () => clearTimeout(t);
  }, [fading]);

  if (!ready || gone) return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[100] bg-background transition-opacity duration-500 ${
        fading ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <video
        src="/opening.mp4"
        className="h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        preload="auto"
        onPlaying={() => {
          started.current = true;
        }}
        onEnded={() => setFading(true)}
        onError={() => setFading(true)}
      />
    </div>
  );
}
