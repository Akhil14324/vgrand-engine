import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Holiday data for the Social Calendar. Run with `pnpm --filter @catgpt/db seed:holidays`
 * (upserts on date+name+country, safe to re-run).
 *
 * - "fixed": same calendar date every year, generated for YEARS.
 * - "curated": lunar/moon-dependent dates copied in by hand for one year. These
 *   need re-checking against an official panchang each year; add next year's rows below.
 */
const YEARS = [2026, 2027, 2028];

type Row = { date: string; name: string; country: string; region?: string; type: string; source: string };

const FIXED: { m: number; d: number; name: string; country: string; region?: string; type: string }[] = [
  { m: 1, d: 1, name: "New Year's Day", country: "ALL", type: "observance" },
  { m: 1, d: 12, name: "National Youth Day", country: "IN", type: "national" },
  { m: 1, d: 14, name: "Makar Sankranti / Pongal", country: "IN", type: "festival" },
  { m: 1, d: 26, name: "Republic Day", country: "IN", type: "national" },
  { m: 2, d: 14, name: "Valentine's Day", country: "ALL", type: "observance" },
  { m: 3, d: 8, name: "International Women's Day", country: "ALL", type: "observance" },
  { m: 4, d: 14, name: "Ambedkar Jayanti / Baisakhi", country: "IN", type: "national" },
  { m: 4, d: 22, name: "Earth Day", country: "ALL", type: "observance" },
  { m: 5, d: 1, name: "Labour Day", country: "ALL", type: "observance" },
  { m: 6, d: 2, name: "Telangana Formation Day", country: "IN", region: "Telangana", type: "national" },
  { m: 6, d: 5, name: "World Environment Day", country: "ALL", type: "observance" },
  { m: 6, d: 21, name: "International Yoga Day", country: "IN", type: "observance" },
  { m: 8, d: 15, name: "Independence Day", country: "IN", type: "national" },
  { m: 9, d: 5, name: "Teachers' Day", country: "IN", type: "observance" },
  { m: 10, d: 2, name: "Gandhi Jayanti", country: "IN", type: "national" },
  { m: 10, d: 31, name: "National Unity Day", country: "IN", type: "national" },
  { m: 11, d: 1, name: "Andhra Pradesh Formation Day", country: "IN", region: "Andhra Pradesh", type: "national" },
  { m: 11, d: 14, name: "Children's Day", country: "IN", type: "observance" },
  { m: 12, d: 25, name: "Christmas", country: "ALL", type: "festival" },
  { m: 12, d: 31, name: "New Year's Eve", country: "ALL", type: "observance" },
];

/** n-th (1-based) given weekday (0=Sun) of a month. */
const nthWeekday = (year: number, month: number, weekday: number, n: number) => {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
};

const CURATED_2026: [string, string, string][] = [
  ["2026-02-15", "Maha Shivratri", "festival"],
  ["2026-03-04", "Holi", "festival"],
  ["2026-03-19", "Ugadi / Gudi Padwa", "festival"],
  ["2026-03-21", "Eid al-Fitr", "festival"],
  ["2026-03-26", "Ram Navami", "festival"],
  ["2026-04-03", "Good Friday", "festival"],
  ["2026-04-05", "Easter", "festival"],
  ["2026-05-01", "Buddha Purnima", "festival"],
  ["2026-05-27", "Eid al-Adha (Bakrid)", "festival"],
  ["2026-08-26", "Onam", "festival"],
  ["2026-08-28", "Raksha Bandhan", "festival"],
  ["2026-09-04", "Janmashtami", "festival"],
  ["2026-09-14", "Ganesh Chaturthi", "festival"],
  ["2026-10-11", "Navratri begins", "festival"],
  ["2026-10-20", "Dussehra", "festival"],
  ["2026-10-29", "Karwa Chauth", "festival"],
  ["2026-11-06", "Dhanteras", "festival"],
  ["2026-11-08", "Diwali", "festival"],
  ["2026-11-11", "Bhai Dooj", "festival"],
  ["2026-11-24", "Guru Nanak Jayanti", "festival"],
];

function build(): Row[] {
  const rows: Row[] = [];
  for (const y of YEARS) {
    const iso = (m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    for (const f of FIXED) rows.push({ date: iso(f.m, f.d), name: f.name, country: f.country, region: f.region, type: f.type, source: "fixed" });
    rows.push({ date: iso(5, nthWeekday(y, 5, 0, 2)), name: "Mother's Day", country: "ALL", type: "observance", source: "fixed" });
    rows.push({ date: iso(6, nthWeekday(y, 6, 0, 3)), name: "Father's Day", country: "ALL", type: "observance", source: "fixed" });
    rows.push({ date: iso(8, nthWeekday(y, 8, 0, 1)), name: "Friendship Day", country: "ALL", type: "observance", source: "fixed" });
  }
  for (const [date, name, type] of CURATED_2026) rows.push({ date, name, country: "IN", type, source: "curated-2026" });
  return rows;
}

async function main() {
  const rows = build();
  for (const r of rows) {
    const date = new Date(`${r.date}T00:00:00Z`);
    await prisma.holiday.upsert({
      where: { date_name_country: { date, name: r.name, country: r.country } },
      update: { region: r.region ?? null, type: r.type, source: r.source },
      create: { date, name: r.name, country: r.country, region: r.region ?? null, type: r.type, source: r.source },
    });
  }
  console.log(`Seeded ${rows.length} holidays`);
}

main().finally(() => prisma.$disconnect());
