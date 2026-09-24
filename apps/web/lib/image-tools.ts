/**
 * Basic, client-side image tools: everything runs in the browser on a canvas,
 * so it costs nothing, uses none of the daily image quota and never uploads.
 */

export interface SizePreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: "ig-post", label: "Instagram post", w: 1080, h: 1080 },
  { id: "ig-portrait", label: "Instagram portrait", w: 1080, h: 1350 },
  { id: "story", label: "Story / Reels / WhatsApp status", w: 1080, h: 1920 },
  { id: "link", label: "Facebook / link preview", w: 1200, h: 630 },
  { id: "yt", label: "YouTube thumbnail", w: 1280, h: 720 },
];

/** Largest side we will produce - keeps canvases inside browser limits. */
const MAX_SIDE = 4096;

async function load(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load the image");
  return createImageBitmap(await res.blob());
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not export the image"))),
      "image/png",
    ),
  );
}

/** Fill w x h exactly, centre-cropping whatever does not fit. */
export async function resizeCover(
  url: string,
  w: number,
  h: number,
): Promise<Blob> {
  const img = await load(url);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingQuality = "high";
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  img.close();
  return toBlob(canvas);
}

/** Enlarge by `factor` (default 2x), capped so the long side stays <= 4096. */
export async function enlarge(url: string, factor = 2): Promise<Blob> {
  const img = await load(url);
  const f = Math.min(factor, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.round(img.width * f);
  const h = Math.round(img.height * f);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  return toBlob(canvas);
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
