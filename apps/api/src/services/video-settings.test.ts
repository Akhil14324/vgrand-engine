import { describe, expect, it } from "vitest";
import { canRunAutopilot, videoSettingsSchema } from "@catgpt/types";

describe("video settings", () => {
  it("accepts a cap with the autopilot off", () => {
    expect(videoSettingsSchema.safeParse({ monthlyCapUsd: 25, autopilotEnabled: false }).success).toBe(true);
  });

  it("accepts no cap with the autopilot off", () => {
    expect(videoSettingsSchema.safeParse({ monthlyCapUsd: null, autopilotEnabled: false }).success).toBe(true);
  });

  it("refuses the autopilot without a cap", () => {
    const res = videoSettingsSchema.safeParse({ monthlyCapUsd: null, autopilotEnabled: true });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.path).toEqual(["autopilotEnabled"]);
  });

  it("accepts the autopilot with a cap", () => {
    expect(videoSettingsSchema.safeParse({ monthlyCapUsd: 50, autopilotEnabled: true }).success).toBe(true);
  });

  it.each([0, -5, 10_001])("refuses a cap of %s", (monthlyCapUsd) => {
    expect(videoSettingsSchema.safeParse({ monthlyCapUsd, autopilotEnabled: false }).success).toBe(false);
  });

  it("runs the autopilot only when it is on and a cap is set", () => {
    expect(canRunAutopilot({ monthlyCapUsd: 50, autopilotEnabled: true })).toBe(true);
    expect(canRunAutopilot({ monthlyCapUsd: 50, autopilotEnabled: false })).toBe(false);
    expect(canRunAutopilot({ monthlyCapUsd: null, autopilotEnabled: true })).toBe(false);
  });
});
