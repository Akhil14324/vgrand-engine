import { describe, expect, it } from "vitest";
import { instagramCanvas, parseDimensions } from "./reframe.js";

describe("instagramCanvas", () => {
  it("leaves in-range images alone", () => {
    expect(instagramCanvas(1088, 1360)).toBeNull(); // 4:5
    expect(instagramCanvas(1024, 1024)).toBeNull();
    expect(instagramCanvas(1536, 1024)).toBeNull(); // 3:2
  });
  it("re-frames a 2:3 portrait to 4:5 and an extreme banner to a square", () => {
    expect(instagramCanvas(1024, 1536)).toEqual({ w: 1080, h: 1350 });
    expect(instagramCanvas(2000, 800)).toEqual({ w: 1080, h: 1080 });
  });
});

describe("parseDimensions", () => {
  it("reads the size and ignores hex codec tags", () => {
    const banner =
      "Stream #0:0: Video: png, rgba(pc, gbrp), 1024x1536 [SAR 1:1 DAR 2:3], 25 tbr, 25 tbn\n" +
      "Stream #0:1: Video: h264 (avc1 / 0x31637661), yuv420p, 640x480, 30 fps";
    expect(parseDimensions(banner)).toEqual({ width: 1024, height: 1536 });
    expect(parseDimensions("nothing here")).toBeNull();
  });
});
