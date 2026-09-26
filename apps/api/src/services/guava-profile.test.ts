import { describe, expect, it } from "vitest";
import {
  computeGuavaCompleteness,
  diffGuavaValues,
  guavaReportSchema,
  suggestGuavaIndustry,
} from "@catgpt/types";
import { brandDerivedValues, resolveValues } from "./guava-profile.js";

describe("guava profile", () => {
  it("fills gaps from the brand but lets saved answers win", () => {
    const derived = brandDerivedValues({
      name: "Spice Route",
      category: "restaurant",
      profile: { location: "Hyderabad", monthlyBudget: 20000 },
    });
    const { values, inheritedKeys } = resolveValues(
      { overview: { location: "Secunderabad" } },
      derived,
    );
    expect(values.overview!.location).toBe("Secunderabad");
    expect(values.overview!.name).toBe("Spice Route");
    expect(inheritedKeys).toContain("overview.name");
    expect(inheritedKeys).not.toContain("overview.location");
  });

  it("keeps a deliberately blank saved answer blank", () => {
    const { values } = resolveValues(
      { overview: { location: "" } },
      { overview: { location: "Hyderabad" } },
    );
    expect(values.overview!.location).toBe("");
  });

  it("measures completeness on important fields and honours skipped sections", () => {
    const empty = computeGuavaCompleteness({}, "restaurant", ["sales"]);
    expect(empty.pct).toBe(0);
    expect(empty.sections.find((s) => s.key === "sales")!.status).toBe("skipped");
    expect(empty.missing.some((m) => m.section === "sales")).toBe(false);
    // Industry fields are asked for restaurants only.
    expect(empty.missing.some((m) => m.field === "menu")).toBe(true);
    expect(computeGuavaCompleteness({}, "retail").missing.some((m) => m.field === "menu")).toBe(false);

    const some = computeGuavaCompleteness({ overview: { name: "A", products: "B", location: "C" } }, null);
    expect(some.sections.find((s) => s.key === "overview")!.status).toBe("good");
    expect(some.pct).toBeGreaterThan(0);
  });

  it("suggests an industry from brand text", () => {
    expect(suggestGuavaIndustry("Family restaurant and catering")).toBe("restaurant");
    expect(suggestGuavaIndustry("Luxury apartments builder")).toBe("real_estate");
    expect(suggestGuavaIndustry("zzz")).toBeNull();
  });

  it("diffs two profiles by field", () => {
    const changes = diffGuavaValues(
      { goals: { main: "Grow" } },
      { goals: { main: "Grow fast" }, marketing: { budget: "10k" } },
      null,
    );
    expect(changes.map((c) => c.field).sort()).toEqual(["budget", "main"]);
  });

  it("survives malformed model output", () => {
    const report = guavaReportSchema.parse({
      headline: 5,
      strengths: [{ title: "Good photos", evidence: "nonsense" }, "junk"],
      recommendations: [{ title: "Do X", priority: "urgent", how: "not a list" }],
    });
    expect(report.headline).toBe("");
    expect(report.strengths).toHaveLength(1);
    expect(report.strengths[0]!.evidence).toBe("hypothesis");
    expect(report.recommendations[0]!.priority).toBe("medium");
    expect(report.recommendations[0]!.how).toEqual([]);
  });
});
