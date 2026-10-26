import { describe, expect, it } from "vitest";
import {
  evaluateChecks,
  overallQa,
  parseBlackSeconds,
  parseFreezeSeconds,
  parseLoudness,
  type QaMetrics,
} from "./video-qa-logic.js";

const clean: QaMetrics = {
  durationSec: 15,
  expectedDurationSec: 15,
  width: 720,
  height: 1280,
  expectedWidth: 720,
  expectedHeight: 1280,
  hasAudio: true,
  integratedLufs: -16.2,
  truePeakDb: -2,
  blackSec: 0,
  freezeSec: 0,
};

const byId = (checks: ReturnType<typeof evaluateChecks>, id: string) => checks.find((c) => c.id === id)!;

describe("parsers", () => {
  it("takes the last loudness summary ffmpeg prints", () => {
    const stderr = [
      "[Parsed_ebur128_0 @ 0x1] t: 0.1  M: -30.0 S: -30.0 I: -35.0 LUFS LRA: 0.0 LU",
      "Summary:",
      "  Integrated loudness:",
      "    I:         -16.4 LUFS",
      "  Loudness range:",
      "    LRA:         3.2 LU",
      "  True peak:",
      "    Peak:       -1.2 dBFS",
    ].join("\n");
    expect(parseLoudness(stderr)).toEqual({ integratedLufs: -16.4, truePeakDb: -1.2 });
  });

  it("returns nulls when there's no summary", () => {
    expect(parseLoudness("nothing here")).toEqual({ integratedLufs: null, truePeakDb: null });
  });

  it("adds up every black stretch", () => {
    const stderr = "black_start:0 black_end:1.2 black_duration:1.2\nblack_start:5 black_end:5.6 black_duration:0.6";
    expect(parseBlackSeconds(stderr)).toBeCloseTo(1.8);
  });

  it("adds up every frozen stretch", () => {
    expect(parseFreezeSeconds("lavfi.freezedetect.freeze_duration: 2.5\nlavfi.freezedetect.freeze_duration: 1")).toBeCloseTo(3.5);
  });
});

describe("evaluateChecks", () => {
  it("passes a clean reel", () => {
    const checks = evaluateChecks(clean);
    expect(overallQa(checks)).toBe("pass");
  });

  it("fails a reel with the wrong frame size", () => {
    const checks = evaluateChecks({ ...clean, width: 1280, height: 720 });
    expect(byId(checks, "frame").status).toBe("fail");
    expect(overallQa(checks)).toBe("fail");
  });

  it("warns, not fails, on loudness that's off target", () => {
    const checks = evaluateChecks({ ...clean, integratedLufs: -11 });
    expect(byId(checks, "loudness").status).toBe("warn");
    expect(overallQa(checks)).toBe("warn");
  });

  it("fails clipping above -1 dBTP", () => {
    expect(byId(evaluateChecks({ ...clean, truePeakDb: -0.2 }), "peak").status).toBe("fail");
  });

  it("warns on a short black gap and fails on a long one", () => {
    expect(byId(evaluateChecks({ ...clean, blackSec: 0.8 }), "black").status).toBe("warn");
    expect(byId(evaluateChecks({ ...clean, blackSec: 2 }), "black").status).toBe("fail");
  });

  it("warns when the reel has no sound", () => {
    expect(byId(evaluateChecks({ ...clean, hasAudio: false }), "audio").status).toBe("warn");
  });

  it("allows half a second of length drift and warns past that", () => {
    expect(byId(evaluateChecks({ ...clean, durationSec: 15.4 }), "duration").status).toBe("pass");
    expect(byId(evaluateChecks({ ...clean, durationSec: 15.8 }), "duration").status).toBe("warn");
  });
});
