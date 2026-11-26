import { createCanvas, loadImage } from "@napi-rs/canvas";
import { coverCropRect } from "../services/carousel-logic.js";

/**
 * Center-crops and resizes an image to exactly width x height (PNG). Used for
 * carousel slides, which must all share the exact Instagram dimensions.
 */
export async function fitImageToSize(input: Buffer, width: number, height: number): Promise<Buffer> {
  const img = await loadImage(input);
  if (img.width === width && img.height === height) return input;
  const r = coverCropRect(img.width, img.height, width, height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height);
  return canvas.encode("png");
}

export async function imageDimensions(input: Buffer): Promise<{ width: number; height: number }> {
  const img = await loadImage(input);
  return { width: img.width, height: img.height };
}
