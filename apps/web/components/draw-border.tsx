"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

gsap.registerPlugin(DrawSVGPlugin);

/**
 * A rounded-rect path that starts and ends at the BOTTOM-mid point. By the
 * shape's left/right symmetry, the TOP-mid point always sits exactly at the
 * 50% mark of this closed path — which is what lets `drawSVG: "50% 50%" ->
 * "0% 100%"` grow the stroke outward from top-mid in both directions at
 * once, meeting again at the start point once fully drawn.
 */
function roundedRectFromBottomMid(w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${w / 2} ${h}`,
    `L ${rad} ${h}`,
    `A ${rad} ${rad} 0 0 1 0 ${h - rad}`,
    `L 0 ${rad}`,
    `A ${rad} ${rad} 0 0 1 ${rad} 0`,
    `L ${w - rad} 0`,
    `A ${rad} ${rad} 0 0 1 ${w} ${rad}`,
    `L ${w} ${h - rad}`,
    `A ${rad} ${rad} 0 0 1 ${w - rad} ${h}`,
    "Z",
  ].join(" ");
}

/**
 * A focus ring that draws itself on: the stroke starts as a single point at
 * the top center of the wrapped box and grows around the border in both
 * directions, meeting at the bottom center once complete — instead of a
 * ring/box-shadow just appearing all at once. It's an absolutely-positioned
 * SVG overlay sized to the target element's live dimensions (remeasured
 * whenever it becomes active, since e.g. a textarea's wrapper can grow).
 */
export function DrawBorder({
  targetRef,
  active,
  radius = 28,
  strokeWidth = 1.5,
}: {
  targetRef: RefObject<HTMLElement | null>;
  active: boolean;
  radius?: number;
  strokeWidth?: number;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!active) return;
    const el = targetRef.current;
    if (!el) return;
    setBox({ w: el.offsetWidth, h: el.offsetHeight });
  }, [active, targetRef]);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    if (active) {
      gsap.fromTo(
        path,
        { drawSVG: "50% 50%" },
        { drawSVG: "0% 100%", duration: 0.6, ease: "power2.inOut" },
      );
    } else {
      gsap.to(path, { drawSVG: "50% 50%", duration: 0.25, ease: "power1.in" });
    }
  }, [active, box]);

  if (!box) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${box.w} ${box.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        ref={pathRef}
        d={roundedRectFromBottomMid(box.w, box.h, radius)}
        fill="none"
        stroke="hsl(var(--ring))"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
