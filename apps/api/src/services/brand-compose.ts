import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { prisma } from "@catgpt/db";
import { brandProfileSchema, type BrandProfile, type LogoCorner } from "@catgpt/types";
import { isTrustedImageUrl } from "../lib/urls.js";

/* ------------------------------ pure layout ------------------------------ */

export interface LogoPlacement {
  corner: LogoCorner;
  sizePct: number;
  marginPct: number;
}

/** Used when a brand has not chosen a placement. */
export const DEFAULT_PLACEMENT: LogoPlacement = { corner: "bottom-right", sizePct: 18, marginPct: 4 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the logo goes: width is `sizePct` of the image width (never taller than a
 * quarter of the image), aspect ratio preserved, `marginPct` of the width from the edges.
 */
export function computeLogoRect(
  imgW: number,
  imgH: number,
  logoW: number,
  logoH: number,
  placement: LogoPlacement,
): Rect {
  const margin = Math.round((imgW * placement.marginPct) / 100);
  let w = (imgW * placement.sizePct) / 100;
  let h = (w * logoH) / logoW;
  const maxH = imgH * 0.25;
  if (h > maxH) {
    h = maxH;
    w = (h * logoW) / logoH;
  }
  w = Math.round(w);
  h = Math.round(h);
  const x = placement.corner.endsWith("left") ? margin : imgW - margin - w;
  const y = placement.corner.startsWith("top") ? margin : imgH - margin - h;
  return { x, y, w, h };
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.179 ? "#000000" : "#ffffff";
}

/** Greedy word wrap using a caller-supplied width measure; overflow gets an ellipsis. */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length && lines.length) {
    let last = lines[lines.length - 1]!;
    while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/* --------------------------------- assets --------------------------------- */

const MAX_KIT_ASSET_BYTES = 12 * 1024 * 1024;

/** Only our own storage is fetched (SSRF-safe), with a timeout and size cap. */
export async function fetchOwnBytes(url: string): Promise<Buffer> {
  if (!isTrustedImageUrl(url)) throw new Error("asset is not on this app's storage");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`asset download failed (${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_KIT_ASSET_BYTES) throw new Error("asset too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_KIT_ASSET_BYTES) throw new Error("asset too large");
  return buf;
}

const FALLBACK_FAMILY = "brandkit-fallback";
let fallbackReady = false;
function ensureFallbackFont(): string {
  if (!fallbackReady) {
    const path = fileURLToPath(new URL("../../assets/fonts/NotoSans-Regular.ttf", import.meta.url));
    GlobalFonts.register(readFileSync(path), FALLBACK_FAMILY);
    fallbackReady = true;
  }
  return FALLBACK_FAMILY;
}

const fontFamilies = new Map<string, string>();
/** Registers an uploaded font once per URL; any failure falls back to the bundled font. */
async function fontFamilyFor(url: string | null): Promise<string> {
  const fallback = ensureFallbackFont();
  if (!url) return fallback;
  const cached = fontFamilies.get(url);
  if (cached) return cached;
  try {
    const family = `brandkit-${createHash("sha1").update(url).digest("hex").slice(0, 12)}`;
    const ok = GlobalFonts.register(await fetchOwnBytes(url), family);
    if (!ok) throw new Error("font could not be parsed");
    fontFamilies.set(url, family);
    return family;
  } catch (err) {
    console.warn("[brand-kit] font unavailable, using fallback:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

const FONT_MAGIC = ["00010000", "74727565", "4f54544f", "774f4646", "774f4632"]; // ttf, 'true', otf, woff, woff2

/** True when the bytes are a font we can actually render with (checked, not trusted by extension). */
export function isUsableFont(buf: Buffer): boolean {
  if (buf.length < 12 || !FONT_MAGIC.includes(buf.subarray(0, 4).toString("hex"))) return false;
  return GlobalFonts.register(buf, `probe-${createHash("sha1").update(buf).digest("hex").slice(0, 12)}`) !== null;
}

export interface BrandKit {
  profile: BrandProfile;
  placement: LogoPlacement;
  logoUrl: string | null;
  headingFontUrl: string | null;
  bodyFontUrl: string | null;
}

/** The brand's kit; `userId` (when given) must be able to use the brand. */
export async function loadBrandKit(brandId: string): Promise<BrandKit | null> {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: {
      profile: true,
      assets: {
        where: { kind: { in: ["logo", "font"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, url: true },
      },
    },
  });
  if (!brand) return null;
  const parsed = brandProfileSchema.safeParse(brand.profile ?? {});
  const profile = parsed.success ? parsed.data : {};
  const fontUrl = (id?: string) => brand.assets.find((a) => a.kind === "font" && a.id === id)?.url ?? null;
  return {
    profile,
    placement: profile.logoPlacement ?? DEFAULT_PLACEMENT,
    logoUrl: brand.assets.find((a) => a.kind === "logo")?.url ?? null,
    headingFontUrl: fontUrl(profile.fonts?.heading),
    bodyFontUrl: fontUrl(profile.fonts?.body),
  };
}

/** The kit when new generations should get the real logo automatically, else null. */
export async function loadAutoStampKit(brandId: string | null | undefined): Promise<BrandKit | null> {
  if (!brandId) return null;
  const kit = await loadBrandKit(brandId);
  return kit?.profile.overlayDefault && kit.logoUrl ? kit : null;
}

/* -------------------------------- rendering -------------------------------- */

export interface ComposeOptions {
  /** Stamp the real logo. */
  logo: boolean;
  headline?: string;
  cta?: string;
}

/**
 * Draws the brand kit onto an image: the REAL logo file (never an AI redraw),
 * plus optional headline / CTA text in the brand's fonts on a legibility scrim.
 * Text sits on the side opposite the logo. Returns PNG bytes, or null when
 * there is nothing to draw.
 */
export async function composeBrandKit(
  image: Buffer,
  kit: BrandKit,
  opts: ComposeOptions,
): Promise<Buffer | null> {
  const headline = opts.headline?.trim();
  const cta = opts.cta?.trim();
  const logoBytes = opts.logo && kit.logoUrl ? await fetchOwnBytes(kit.logoUrl) : null;
  if (!logoBytes && !headline && !cta) return null;

  const base = await loadImage(image);
  const W = base.width;
  const H = base.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(base, 0, 0, W, H);

  const { placement } = kit;
  const margin = Math.round((W * placement.marginPct) / 100);

  if (headline || cta) {
    const headingFamily = await fontFamilyFor(kit.headingFontUrl);
    const bodyFamily = await fontFamilyFor(kit.bodyFontUrl ?? kit.headingFontUrl);
    const atTop = placement.corner.startsWith("bottom") && !!logoBytes;
    const maxWidth = W - margin * 2;
    const headSize = Math.max(28, Math.round(W * 0.06));
    const ctaSize = Math.max(18, Math.round(W * 0.032));

    ctx.font = `${headSize}px "${headingFamily}"`;
    const lines = headline ? wrapText((s) => ctx.measureText(s).width, headline, maxWidth, 3) : [];
    const lineH = Math.round(headSize * 1.2);
    const headH = lines.length * lineH;
    const pillH = cta ? Math.round(ctaSize * 2) : 0;
    const gap = cta && lines.length ? Math.round(headSize * 0.5) : 0;
    const blockH = headH + gap + pillH;

    // Scrim: fades from the image edge so light text stays readable on any photo.
    const scrimH = Math.min(H * 0.6, blockH + margin * 3);
    const edgeY = atTop ? 0 : H - scrimH;
    const grad = ctx.createLinearGradient(0, atTop ? 0 : H, 0, atTop ? scrimH : H - scrimH);
    grad.addColorStop(0, "rgba(0,0,0,0.62)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, edgeY, W, scrimH);

    let y = atTop ? margin : H - margin - blockH;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.font = `${headSize}px "${headingFamily}"`;
    for (const line of lines) {
      ctx.fillText(line, margin, y);
      y += lineH;
    }
    if (cta) {
      y += gap;
      ctx.font = `${ctaSize}px "${bodyFamily}"`;
      const padX = Math.round(ctaSize * 1.1);
      const pillW = Math.round(ctx.measureText(cta).width + padX * 2);
      const fill = kit.profile.colors?.[0] ?? "#ffffff";
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(margin, y, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = readableTextColor(fill);
      ctx.textBaseline = "middle";
      ctx.fillText(cta, margin + padX, y + pillH / 2);
    }
  }

  if (logoBytes) {
    const logo = await loadImage(logoBytes);
    const r = computeLogoRect(W, H, logo.width, logo.height, placement);
    ctx.drawImage(logo, r.x, r.y, r.w, r.h);
  }

  return canvas.encode("png");
}
