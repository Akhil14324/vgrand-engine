"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Opening splash — plays the launch video on every fresh page load while the
 * app mounts and data loads underneath it. When the video ends, the overlay
 * fades out and the already-loaded app is revealed.
 *
 * Shows on mount only: full page loads / PWA launches replay it, in-app
 * client-side navigations do not.
 */
export function Splash() {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  const started = useRef(false);

  // If the video never starts (autoplay blocked / decode error), don't trap
  // the user — bail out shortly after mount instead.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!started.current) setFading(true);
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setGone(true), 500);
    return () => clearTimeout(t);
  }, [fading]);

  if (gone) return null;

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
