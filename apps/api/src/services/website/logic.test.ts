import { describe, expect, it } from "vitest";
import { canView, countBy, isMissing, leadsCsvRows, searchTerm, toConsentDto, toLeadDto } from "./logic.js";

describe("website integration logic", () => {
  it("lets only allowlisted emails see the website data", () => {
    expect(canView("Ravi@VGrand.com", " ravi@vgrand.com , sita@vgrand.com")).toBe(true);
    expect(canView("other@vgrand.com", "ravi@vgrand.com")).toBe(false);
    expect(canView("ravi@vgrand.com", undefined)).toBe(false);
    expect(canView(null, "ravi@vgrand.com")).toBe(false);
  });

  it("counts by a column, biggest first, with blanks as direct", () => {
    const rows = [{ s: "instagram" }, { s: "google" }, { s: "instagram" }, { s: null }, { s: "" }];
    expect(countBy(rows, "s")).toEqual([
      { name: "direct", total: 2 },
      { name: "instagram", total: 2 },
      { name: "google", total: 1 },
    ]);
  });

  it("strips characters that would change the PostgREST filter", () => {
    expect(searchTerm("ravi),phone.eq.1")).toBe("ravi phone eq 1");
    expect(searchTerm("98*%")).toBe("98");
    expect(searchTerm("a")).toBeNull();
    expect(searchTerm(undefined)).toBeNull();
  });

  it("recognises a table or column the website hasn't added yet", () => {
    expect(isMissing({ code: "42P01" })).toBe(true);
    expect(isMissing({ code: "42703" })).toBe(true);
    expect(isMissing({ message: 'relation "public.site_events" does not exist' })).toBe(true);
    expect(isMissing({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isMissing(null)).toBe(false);
  });

  it("maps a lead row whatever columns it has", () => {
    const lead = toLeadDto({ id: 7, name: "Ramesh", phone: "9876543210", source: "site_visit", interested_flat: "Gateway 970", utm_source: "instagram", created_at: "2026-11-27T10:00:00Z" });
    expect(lead).toMatchObject({ id: "7", name: "Ramesh", form: "site_visit", project: "Gateway 970", source: "instagram", email: null, campaign: null });
  });

  it("keeps only consent rows that have a phone", () => {
    expect(toConsentDto({ id: 1, phone: null })).toBeNull();
    expect(toConsentDto({ id: 2, phone: "9876543210", consent_text: "I agree", created_at: "2026-11-27T10:00:00Z" })).toMatchObject({ phone: "9876543210", consentText: "I agree" });
  });

  it("builds CSV rows with readable form names", () => {
    const rows = leadsCsvRows([toLeadDto({ id: 1, name: "Sita", phone: "9", source: "enquire_now", created_at: "2026-11-27T10:05:00Z" })]);
    expect(rows[0]![0]).toBe("Date");
    expect(rows[1]).toEqual(["2026-11-27 10:05", "Sita", "9", "", "Enquire Now", "", "", "", "", "", ""]);
  });
});
