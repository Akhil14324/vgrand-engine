import { writeFile } from "node:fs/promises";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { fontFamilyFor } from "../brand-compose.js";

/**
 * Still graphics for Reel Studio, drawn with the brand's colours and fonts:
 * animated-headline overlays (transparent PNG), brand graphic cards, intro and
 * outro cards. ffmpeg then animates them (fade/slide, Ken Burns).
 */

export interface CardTheme {
  /** Two or more #RRGGBB colours; the first is the primary. */
  colors: string[];
  headingFont: string;
  bodyFont: string;
  logo: Buffer | null;
  brandName: string | null;
}

export async function cardTheme(input: { colors: string[]; headingFontUrl: string | null; bodyFontUrl: string | null; logo: Buffer | null; brandName: string | null; seed: string }): Promise<CardTheme> {
  const colors = input.colors.length >= 2 ? input.colors : input.colors.length === 1 ? [input.colors[0]!, shade(input.colors[0]!, -0.45)] : paletteFor(input.seed);
  return {
    colors,
    headingFont: await fontFamilyFor(input.headingFontUrl),
    bodyFont: await fontFamilyFor(input.bodyFontUrl ?? input.headingFontUrl),
    logo: input.logo,
    brandName: input.brandName,
  };
}

/** Deterministic, tasteful palette for general (non-brand) reels. */
const PALETTES = [
  ["#6D28D9", "#DB2777"],
  ["#0EA5E9", "#1E3A8A"],
  ["#F97316", "#B91C1C"],
  ["#10B981", "#065F46"],
  ["#F59E0B", "#7C2D12"],
  ["#14B8A6", "#312E81"],
];
export function paletteFor(seed: string): string[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Relative luminance: picks readable text colour on a background. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160;
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Fits text into a box: shrinks the font until the wrapped lines fit. */
function fitText(ctx: SKRSContext2D, text: string, font: string, maxWidth: number, maxLines: number, startSize: number, minSize: number) {
  let size = startSize;
  let lines: string[] = [];
  for (; size >= minSize; size -= 4) {
    ctx.font = `bold ${size}px "${font}"`;
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) break;
  }
  return { size, lines };
}

function gradientBg(ctx: SKRSContext2D, w: number, h: number, colors: string[]) {
  const g = ctx.createLinearGradient(0, 0, w * 0.6, h);
  g.addColorStop(0, colors[0]!);
  g.addColorStop(1, colors[1] ?? shade(colors[0]!, -0.4));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Soft light blobs for depth.
  for (const [x, y, r, a] of [
    [w * 0.15, h * 0.2, w * 0.7, 0.18],
    [w * 0.9, h * 0.75, w * 0.8, 0.12],
  ] as const) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(255,255,255,${a})`);
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawLogo(ctx: SKRSContext2D, logo: Buffer, cx: number, cy: number, maxW: number, maxH: number) {
  const img = await loadImage(logo);
  const s = Math.min(maxW / img.width, maxH / img.height);
  ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
}

/**
 * Transparent full-frame PNG with the scene headline in a brand-coloured pill,
 * placed in the upper third (subtitles sit low). ffmpeg fades/slides it in.
 */
export async function headlineOverlay(text: string, theme: CardTheme, size: { w: number; h: number }, dest: string, position: "top" | "center" = "top"): Promise<void> {
  const { w, h } = size;
  const k = w / 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const maxW = w * 0.8;
  const { size: fs, lines } = fitText(ctx, text, theme.headingFont, maxW - 80 * k, 3, Math.round(82 * k), Math.round(44 * k));
  ctx.font = `bold ${fs}px "${theme.headingFont}"`;
  const lineH = fs * 1.2;
  const boxW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 80 * k);
  const boxH = lines.length * lineH + 50 * k;
  const x = (w - boxW) / 2;
  const y = position === "top" ? h * 0.15 : h * 0.42;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 30 * k;
  ctx.shadowOffsetY = 8 * k;
  roundRect(ctx, x, y, boxW, boxH, 28 * k);
  ctx.fillStyle = theme.colors[0]!;
  ctx.fill();
  ctx.shadowColor = "transparent";
  // Accent bar in the secondary colour.
  ctx.fillStyle = theme.colors[1] ?? "#ffffff";
  roundRect(ctx, x + boxW * 0.35, y + boxH - 10 * k, boxW * 0.3, 10 * k, 5 * k);
  ctx.fill();
  ctx.fillStyle = isLight(theme.colors[0]!) ? "#111111" : "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, y + 25 * k + lineH * (i + 0.5)));
  await writeFile(dest, await canvas.encode("png"));
}

/** Full-frame brand graphic for a scene with no suitable photo/footage: gradient, big headline, logo. */
export async function graphicCard(text: string, sub: string, theme: CardTheme, size: { w: number; h: number }, dest: string): Promise<void> {
  const { w, h } = size;
  const k = w / 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  gradientBg(ctx, w, h, theme.colors);
  const fg = isLight(theme.colors[0]!) ? "#111111" : "#FFFFFF";
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const { size: fs, lines } = fitText(ctx, text || sub, theme.headingFont, w * 0.82, 5, Math.round(120 * k), Math.round(56 * k));
  ctx.font = `bold ${fs}px "${theme.headingFont}"`;
  const lineH = fs * 1.18;
  const top = h * 0.42 - (lines.length * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + lineH * (i + 0.5)));
  if (text && sub) {
    const s2 = fitText(ctx, sub, theme.bodyFont, w * 0.78, 4, Math.round(52 * k), Math.round(34 * k));
    ctx.font = `${s2.size}px "${theme.bodyFont}"`;
    ctx.globalAlpha = 0.9;
    const t2 = top + lines.length * lineH + 60 * k;
    s2.lines.forEach((l, i) => ctx.fillText(l, w / 2, t2 + s2.size * 1.3 * i));
    ctx.globalAlpha = 1;
  }
  if (theme.logo) await drawLogo(ctx, theme.logo, w / 2, h * 0.14, w * 0.32, h * 0.08).catch(() => {});
  await writeFile(dest, await canvas.encode("png"));
}

/** Intro: logo (or brand name) reveal on the brand gradient, plus the reel title. */
export async function introCard(title: string, theme: CardTheme, size: { w: number; h: number }, dest: string): Promise<void> {
  const { w, h } = size;
  const k = w / 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  gradientBg(ctx, w, h, theme.colors);
  const fg = isLight(theme.colors[0]!) ? "#111111" : "#FFFFFF";
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let y = h * 0.4;
  if (theme.logo) {
    await drawLogo(ctx, theme.logo, w / 2, h * 0.36, w * 0.55, h * 0.2).catch(() => {});
    y = h * 0.55;
  } else if (theme.brandName) {
    const b = fitText(ctx, theme.brandName, theme.headingFont, w * 0.8, 2, Math.round(130 * k), Math.round(64 * k));
    ctx.font = `bold ${b.size}px "${theme.headingFont}"`;
    b.lines.forEach((l, i) => ctx.fillText(l, w / 2, h * 0.36 + b.size * 1.15 * i));
    y = h * 0.36 + b.lines.length * b.size * 1.15 + 60 * k;
  }
  const t = fitText(ctx, title, theme.bodyFont, w * 0.8, 3, Math.round(64 * k), Math.round(38 * k));
  ctx.font = `bold ${t.size}px "${theme.bodyFont}"`;
  ctx.globalAlpha = 0.95;
  t.lines.forEach((l, i) => ctx.fillText(l, w / 2, y + t.size * 1.25 * i));
  await writeFile(dest, await canvas.encode("png"));
}

/** Outro: call to action, brand name/handle, logo. */
export async function outroCard(cta: string, tagline: string, theme: CardTheme, size: { w: number; h: number }, dest: string): Promise<void> {
  const { w, h } = size;
  const k = w / 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  gradientBg(ctx, w, h, [theme.colors[1] ?? theme.colors[0]!, theme.colors[0]!]);
  const bg = theme.colors[1] ?? theme.colors[0]!;
  const fg = isLight(bg) ? "#111111" : "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (theme.logo) await drawLogo(ctx, theme.logo, w / 2, h * 0.24, w * 0.45, h * 0.14).catch(() => {});
  else if (theme.brandName) {
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.round(96 * k)}px "${theme.headingFont}"`;
    ctx.fillText(theme.brandName, w / 2, h * 0.24);
  }
  // CTA button.
  const c = fitText(ctx, cta || "Follow for more", theme.headingFont, w * 0.72, 3, Math.round(84 * k), Math.round(44 * k));
  ctx.font = `bold ${c.size}px "${theme.headingFont}"`;
  const lineH = c.size * 1.2;
  const boxW = Math.min(w * 0.86, Math.max(...c.lines.map((l) => ctx.measureText(l).width)) + 120 * k);
  const boxH = c.lines.length * lineH + 70 * k;
  const bx = (w - boxW) / 2;
  const by = h * 0.46;
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 40 * k;
  roundRect(ctx, bx, by, boxW, boxH, boxH / 2.2);
  ctx.fillStyle = fg === "#FFFFFF" ? "#FFFFFF" : "#111111";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fg === "#FFFFFF" ? (theme.colors[0] ?? "#111111") : "#FFFFFF";
  c.lines.forEach((l, i) => ctx.fillText(l, w / 2, by + 35 * k + lineH * (i + 0.5)));
  if (tagline) {
    ctx.fillStyle = fg;
    const t = fitText(ctx, tagline, theme.bodyFont, w * 0.8, 2, Math.round(50 * k), Math.round(32 * k));
    ctx.font = `${t.size}px "${theme.bodyFont}"`;
    t.lines.forEach((l, i) => ctx.fillText(l, w / 2, by + boxH + 90 * k + t.size * 1.3 * i));
  }
  await writeFile(dest, await canvas.encode("png"));
}

/** The logo as a PNG file for the watermark overlay. */
export async function logoPng(logo: Buffer, dest: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(logo);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  await writeFile(dest, await canvas.encode("png"));
  return { width: img.width, height: img.height };
}
