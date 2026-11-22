"use client";

import { useEffect } from "react";
import { redrawSketch, sketchElement, unsketchDisconnected } from "@/lib/sketch";

/**
 * Gives every plain bordered panel in the app a hand-drawn pen outline, so
 * hundreds of ad-hoc `rounded-xl border` boxes match the sketchbook look
 * without being rewritten one by one. Skips: dashed borders (already look
 * hand-made), overflow-hidden boxes (media thumbnails), form controls and
 * anything already sketched by a ui primitive.
 */
const SHAPED = /(^|\s)rounded-(md|lg|xl|2xl|3xl|\[[^\]]+\])(\s|$)/;
const BORDERED = /(^|\s)border(\s|$)/;
const SKIP = /(^|\s)(border-dashed|border-0|overflow-hidden|sk|sk-auto|rounded-full|no-sketch)(\s|$)/;

function wants(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "SVG" || tag === "IMG") return false;
  const cls = el.getAttribute("class") ?? "";
  return BORDERED.test(cls) && SHAPED.test(cls) && !SKIP.test(cls);
}

export function AutoSketch() {
  useEffect(() => {
    let raf = 0;
    const pending = new Set<Element>();
    let sweep = true;

    const run = () => {
      raf = 0;
      if (sweep) {
        sweep = false;
        document.querySelectorAll<HTMLElement>("[class*='border']").forEach((el) => {
          if (wants(el)) sketchElement(el);
        });
        unsketchDisconnected();
      }
      pending.forEach((el) => {
        if (!el.isConnected) return;
        if (el.classList.contains("sk-auto")) redrawSketch(el as HTMLElement);
        else if (wants(el)) sketchElement(el as HTMLElement);
      });
      pending.clear();
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") sweep = true;
        else pending.add(r.target as Element);
      }
      queue();
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    queue();
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
