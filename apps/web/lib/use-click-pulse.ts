"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Instant visual acknowledgment for a click, independent of whatever async
 * state text follows it ("Posting…", "Saving…", …). The button already
 * reacts (scale down/up) on the same frame the click is handled, before any
 * network round-trip resolves — reinforcing that the app responded right
 * away, the same intent as the optimistic-cache work in lib/hooks.ts.
 *
 * Purely a transform tween (no layout properties), so it never triggers
 * reflow and costs nothing when idle.
 */
export function useClickPulse<T extends HTMLElement = HTMLButtonElement>() {
  const ref = useRef<T | null>(null);
  const { contextSafe } = useGSAP({ scope: ref });

  const pulse = contextSafe(() => {
    const el = ref.current;
    if (!el) return;
    gsap.killTweensOf(el);
    gsap
      .timeline()
      .to(el, { scale: 0.94, duration: 0.08, ease: "power1.out" })
      .to(el, { scale: 1, duration: 0.18, ease: "back.out(3)" });
  });

  return { ref, pulse };
}
