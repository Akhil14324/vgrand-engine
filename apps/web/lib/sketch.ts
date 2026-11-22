"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type Ref,
  type RefCallback,
} from "react";
import rough from "roughjs";

/**
 * Hand-drawn outlines (the "sketchbook" look).
 *
 * Each sketched element gets a rough.js rectangle painted as its own CSS
 * `background-image` (an inline SVG data URI). That keeps the DOM untouched —
 * it works on void elements (<input>), Radix `asChild` slots and portalled
 * popovers alike — and the wobble is stable because the seed is fixed per
 * element. Colours are read from the theme CSS variables at draw time, so a
 * light/dark switch simply redraws everything.
 */

export type SketchKind =
  | "paper" // cards, dialogs, menus
  | "button" // primary lavender button
  | "danger" // destructive button
  | "ghost" // secondary / outline button
  | "input" // text fields
  | "active" // focused field: lavender, no fill
  | "chip" // small lavender-outlined pill
  | "warn"; // paper card with an amber pen

interface KindSpec {
  /** CSS variable holding an `H S% L%` triplet, or null for no fill. */
  fill: string | null;
  stroke: string;
  width: number;
  roughness: number;
}

const KINDS: Record<SketchKind, KindSpec> = {
  paper: { fill: "--card", stroke: "--pen", width: 1.8, roughness: 1.1 },
  button: { fill: "--primary", stroke: "--primary-edge", width: 2, roughness: 1.1 },
  danger: { fill: "--destructive", stroke: "--destructive-edge", width: 2, roughness: 1.1 },
  ghost: { fill: "--card", stroke: "--pen", width: 1.5, roughness: 1.1 },
  input: { fill: "--field", stroke: "--pen-soft", width: 1.4, roughness: 1 },
  active: { fill: "--field", stroke: "--primary", width: 2.5, roughness: 1 },
  chip: { fill: null, stroke: "--primary-deep", width: 1.2, roughness: 0.9 },
  warn: { fill: "--card", stroke: "--warn", width: 1.8, roughness: 1.1 },
};

function cssColor(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : "currentColor";
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 9973 || 1;
}

// A border-colour class (border-primary, border-amber-500/40...) means the
// element is making a statement (selected, warning): keep that colour.
const NEUTRAL_BORDER = /^border-(border|input|[0-9]+|[tblrxy](-.*)?|dashed|solid|dotted|transparent|none)$/;
function hasColouredBorder(el: HTMLElement): boolean {
  return String(el.className)
    .split(" ")
    .some((t) => t.startsWith("border-") && !NEUTRAL_BORDER.test(t));
}

function autoSpec(el: HTMLElement): KindSpec {
  const coloured = hasColouredBorder(el);
  return { fill: null, stroke: "--pen-soft", width: coloured ? 1.8 : 1.4, roughness: 1 };
}

function autoStroke(el: HTMLElement): string {
  if (!hasColouredBorder(el)) return cssColor("--pen-soft");
  // Read the real border colour: briefly lift the transparent override, with
  // transitions off so we see the final value and nothing animates.
  const prevTransition = el.style.transition;
  el.style.transition = "none";
  el.classList.remove("sk-drawn");
  const colour = getComputedStyle(el).borderTopColor;
  el.classList.add("sk-drawn");
  el.style.transition = prevTransition;
  return colour;
}

const generator = typeof window === "undefined" ? null : rough.generator();

interface Opts {
  kind: SketchKind | null;
  seed: number;
  /** Auto-sketched plain panel: keep its own background, take the pen colour from its border. */
  auto?: boolean;
}

const live = new Map<HTMLElement, () => Opts>();
const lastKey = new WeakMap<HTMLElement, string>();

function draw(el: HTMLElement, opts: Opts): void {
  if (!generator) return;
  if (!opts.kind) {
    clear(el);
    return;
  }
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (w < 6 || h < 6) return; // hidden or collapsed: nothing to draw yet
  const spec = opts.auto ? autoSpec(el) : KINDS[opts.kind];
  const key = `${opts.kind}|${opts.seed}|${w}x${h}|${document.documentElement.className}|${opts.auto ? el.className : ""}`;
  if (lastKey.get(el) === key) return;
  lastKey.set(el, key);

  const fill = spec.fill ? cssColor(spec.fill) : undefined;
  const stroke = opts.auto ? autoStroke(el) : cssColor(spec.stroke);
  const drawable = generator.rectangle(2, 2, w - 4, h - 4, {
    roughness: spec.roughness * (w > 420 ? 1.7 : w > 200 ? 1.35 : 1),
    bowing: w > 200 ? 1.8 : 1,
    seed: opts.seed,
    stroke,
    strokeWidth: spec.width,
    fill,
    fillStyle: "solid",
    disableMultiStroke: false,
  });
  const paths = generator.toPaths(drawable);
  const body = paths
    .map(
      (p) =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || "none"}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
  el.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  el.style.backgroundSize = "100% 100%";
  el.style.backgroundRepeat = "no-repeat";
  el.style.backgroundOrigin = "border-box";
  el.style.backgroundClip = "border-box";
  if (!opts.auto) el.style.backgroundColor = "transparent";
  el.classList.add("sk-drawn");
}

function clear(el: HTMLElement): void {
  if (!el.classList.contains("sk-drawn")) return;
  lastKey.delete(el);
  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundRepeat = "";
  el.style.backgroundOrigin = "";
  el.style.backgroundClip = "";
  if (!live.get(el)?.().auto) el.style.backgroundColor = "";
  el.classList.remove("sk-drawn");
}

let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let raf = 0;
const dirty = new Set<HTMLElement>();

function flush(): void {
  raf = 0;
  dirty.forEach((el) => {
    const get = live.get(el);
    if (get) draw(el, get());
  });
  dirty.clear();
}

function schedule(el: HTMLElement): void {
  dirty.add(el);
  if (!raf) raf = requestAnimationFrame(flush);
}

function attach(el: HTMLElement, get: () => Opts): void {
  live.set(el, get);
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const e of entries) schedule(e.target as HTMLElement);
    });
    // Theme switches toggle a class on <html>: redraw every outline once.
    themeObserver = new MutationObserver(() => live.forEach((_, node) => schedule(node)));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  resizeObserver.observe(el);
  draw(el, get());
}

function detach(el: HTMLElement): void {
  live.delete(el);
  dirty.delete(el);
  lastKey.delete(el);
  resizeObserver?.unobserve(el);
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Returns a ref callback that paints a hand-drawn outline behind the element.
 * Pass `kind = null` to leave the element un-sketched (e.g. ghost buttons).
 */
export function useSketch<T extends HTMLElement>(
  kind: SketchKind | null,
  forwarded?: Ref<T>,
): RefCallback<T> {
  const id = useId();
  const seed = hashSeed(id);
  const elRef = useRef<T | null>(null);
  const opts = useRef<Opts>({ kind, seed });
  opts.current = { kind, seed };
  const fwd = useRef(forwarded);
  fwd.current = forwarded;

  const ref = useCallback((el: T | null) => {
    if (elRef.current) detach(elRef.current);
    elRef.current = el;
    if (el) attach(el, () => opts.current);
    const f = fwd.current;
    if (typeof f === "function") f(el);
    else if (f) (f as { current: T | null }).current = el;
  }, []);

  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (el) draw(el, opts.current);
  }, [kind]);

  return ref;
}

/** Sketch an arbitrary existing element (used by <AutoSketch/> for plain bordered panels). */
export function sketchElement(el: HTMLElement): void {
  if (live.has(el)) return;
  const seed = hashSeed(el.className + live.size);
  el.classList.add("sk-auto");
  attach(el, () => ({ kind: "ghost", seed, auto: true }));
}

export function unsketchDisconnected(): void {
  live.forEach((_, el) => {
    if (!el.isConnected) detach(el);
  });
}

export function redrawSketch(el: HTMLElement): void {
  if (live.has(el)) schedule(el);
}
