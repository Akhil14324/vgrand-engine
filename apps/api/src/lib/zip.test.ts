import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "./zip.js";

describe("buildZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("writes one local entry per file and a matching end record", () => {
    const zip = buildZip([
      { name: "slide-01.png", data: Buffer.from("aaa") },
      { name: "slide-02.png", data: Buffer.from("bbbb") },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(2);
    expect(zip.includes(Buffer.from("slide-02.png"))).toBe(true);
  });
});
