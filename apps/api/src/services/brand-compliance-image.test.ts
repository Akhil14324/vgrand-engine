import { createServer } from "node:http";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { prepareImage } from "./brand-compliance.js";
import { checkAspect, checkPalette } from "./brand-compliance-rules.js";

// API_PUBLIC_URL is stubbed to http://localhost:4000: only /uploads/ there counts as our storage.
describe("prepareImage", () => {
  it("reads size, samples the palette and downsizes for the vision model", async () => {
    const c = createCanvas(1024, 1536);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e11d48";
    ctx.fillRect(0, 0, 1024, 1536);
    const png = c.toBuffer("image/png");

    const server = createServer((_q, res) => res.writeHead(200, { "content-type": "image/png" }).end(png));
    const listening = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(4000, "127.0.0.1", () => resolve(true));
    });
    if (!listening) {
      console.warn("SKIPPED prepareImage test: port 4000 busy");
      return;
    }
    try {
      const img = await prepareImage("http://localhost:4000/uploads/x.png");
      expect([img.width, img.height]).toEqual([1024, 1536]);
      expect(checkPalette(["#e11d48"], img.sample)!.severity).toBe("pass");
      expect(checkPalette(["#0000ff"], img.sample)!.severity).toBe("info");
      expect(checkAspect(img.width, img.height, ["instagram"])!.severity).toBe("info"); // 2:3 is outside 4:5

      const url = img.dataUrl(512);
      expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
      const back = await loadImage(Buffer.from(url.split(",")[1]!, "base64"));
      expect(Math.max(back.width, back.height)).toBe(512);
    } finally {
      server.close();
    }
  });

  it("refuses URLs that are not our own storage (no server-side fetch of arbitrary hosts)", async () => {
    await expect(prepareImage("https://example.com/a.png")).rejects.toThrow(/storage/);
  });
});
