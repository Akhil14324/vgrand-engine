import { describe, expect, it } from "vitest";
import { parseImageAction } from "./chat.js";

describe("parseImageAction", () => {
  it("keeps new concepts separate from edits to the previous image", () => {
    expect(parseImageAction("edit")).toBe("edit");
    expect(parseImageAction("new")).toBe("new");
    expect(parseImageAction("CHAT.")).toBe("text");
    expect(parseImageAction(undefined)).toBe("unknown");
  });
});
