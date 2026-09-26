import type PDFDocument from "pdfkit";
import { brandProfileSchema, type BrandProfile } from "@catgpt/types";

/**
 * Brand guidelines are stored as plain markdown the user can edit. A fixed set
 * of "structured" sections maps 1:1 onto Brand.profile fields, so saving the
 * document updates what the AI actually uses (colours, tone, forbidden words...).
 * Other sections (essence, audience, do/don't, sample posts) are free text and
 * never parsed.
 */

type FieldKind = "text" | "colors" | "list";
interface Spec {
  key: keyof BrandProfile & string;
  title: string;
  kind: FieldKind;
  /** Max characters (text / list item) - mirrors brandProfileSchema. */
  max: number;
  /** Max items for lists / colours. */
  items?: number;
  aliases?: string[];
}

export const STRUCTURED_SECTIONS: Spec[] = [
  { key: "tagline", title: "Tagline", kind: "text", max: 160 },
  { key: "tone", title: "Tone of voice", kind: "text", max: 300 },
  { key: "colors", title: "Colors", kind: "colors", max: 7, items: 6, aliases: ["colours", "color palette", "colour palette"] },
  { key: "typography", title: "Typography", kind: "text", max: 300, aliases: ["fonts"] },
  { key: "logoRules", title: "Logo usage", kind: "text", max: 500, aliases: ["logo rules", "logo"] },
  { key: "visualStyle", title: "Visual style", kind: "text", max: 300 },
  { key: "photographyStyle", title: "Photography", kind: "text", max: 300, aliases: ["photography style"] },
  { key: "requiredPhrases", title: "Required phrases", kind: "list", max: 120, items: 8, aliases: ["approved phrases"] },
  { key: "forbiddenWords", title: "Words to avoid", kind: "list", max: 60, items: 20, aliases: ["forbidden words"] },
  { key: "forbiddenClaims", title: "Claims we never make", kind: "list", max: 160, items: 20, aliases: ["forbidden claims"] },
  { key: "defaultCta", title: "Call to action", kind: "text", max: 160, aliases: ["cta", "default cta"] },
];

const NOT_SET = "(not set)";
const COLOR_ROLES = ["Primary", "Secondary", "Accent", "Neutral", "Neutral", "Neutral"];

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const isPlaceholder = (s: string) => /^[_*]*\(?\s*not set\s*\)?[_*]*\.?$/i.test(s.trim());

/* -------------------------------- rendering -------------------------------- */

/** AI-written (or user-written) free-text parts of the document. */
export interface GuidelinesNarrative {
  essence: string;
  audience: string;
  dos: string[];
  donts: string[];
  samplePosts: { platform: string; text: string }[];
  /** Suggestions used only where the profile has no value yet. */
  suggestions: Partial<Record<Spec["key"], string>>;
}

export function renderGuidelines(brandName: string, profile: BrandProfile, n: GuidelinesNarrative): string {
  const out: string[] = [`# ${brandName} Brand Guidelines`, ""];
  const section = (title: string, body: string[]) => out.push(`## ${title}`, "", ...body, "");
  const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${oneLine(i)}`) : [`- ${NOT_SET}`]);

  section("Brand essence", [oneLine(n.essence) || NOT_SET]);
  section("Audience", [oneLine(n.audience) || NOT_SET]);

  for (const spec of STRUCTURED_SECTIONS) {
    const own = profile[spec.key] as unknown;
    if (spec.kind === "colors") {
      const colors = (own as string[] | undefined) ?? [];
      section(
        spec.title,
        colors.length ? colors.map((c, i) => `- ${c} - ${COLOR_ROLES[i] ?? "Accent"}`) : [`- ${NOT_SET}`],
      );
    } else if (spec.kind === "list") {
      section(spec.title, bullets((own as string[] | undefined) ?? []));
    } else {
      const value = typeof own === "string" && own.trim() ? own : n.suggestions[spec.key] ?? "";
      section(spec.title, [oneLine(value) || NOT_SET]);
    }
  }

  section("Writing dos and don'ts", [
    "**Do**",
    ...bullets(n.dos),
    "",
    "**Don't**",
    ...bullets(n.donts),
  ]);
  section(
    "Sample posts",
    n.samplePosts.length ? n.samplePosts.map((p) => `- **${oneLine(p.platform)}:** ${oneLine(p.text)}`) : [`- ${NOT_SET}`],
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* --------------------------------- parsing --------------------------------- */

export interface ParsedGuidelines {
  /** Values for every structured section found in the document; undefined = cleared. */
  fields: Partial<Record<Spec["key"], string | string[] | undefined>>;
  /** Keys of the structured sections that exist in the document. */
  present: Spec["key"][];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function splitSections(md: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = [];
      // A duplicated heading keeps its first occurrence.
      if (!sections.has(norm(h[1]!))) sections.set(norm(h[1]!), current);
      continue;
    }
    if (/^#\s/.test(line)) {
      current = null; // a new H1 ends the previous section
      continue;
    }
    current?.push(line);
  }
  return sections;
}

const stripMarker = (l: string) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/^>\s?/, "").trim();
const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l);

export function parseGuidelines(md: string): ParsedGuidelines {
  const sections = splitSections(md);
  const fields: ParsedGuidelines["fields"] = {};
  const present: ParsedGuidelines["present"] = [];

  for (const spec of STRUCTURED_SECTIONS) {
    const lines = [spec.title, ...(spec.aliases ?? [])].map(norm).map((t) => sections.get(t)).find(Boolean);
    if (!lines) continue;
    present.push(spec.key);

    if (spec.kind === "colors") {
      const hexes = [...new Set(lines.join("\n").match(/#[0-9a-f]{6}\b/gi) ?? [])].slice(0, spec.items);
      fields[spec.key] = hexes.length ? hexes : undefined;
    } else if (spec.kind === "list") {
      const items = [
        ...new Set(
          lines
            .filter(isBullet)
            .map(stripMarker)
            .map(oneLine)
            .filter((i) => i && !isPlaceholder(i))
            .map((i) => i.slice(0, spec.max)),
        ),
      ].slice(0, spec.items);
      fields[spec.key] = items.length ? items : undefined;
    } else {
      const text = oneLine(lines.map(stripMarker).filter(Boolean).join(" "));
      fields[spec.key] = !text || isPlaceholder(text) ? undefined : text.slice(0, spec.max);
    }
  }
  return { fields, present };
}

/** Applies parsed sections onto a profile: present -> set (or cleared when empty), absent -> untouched. */
export function mergeIntoProfile(
  profile: BrandProfile,
  parsed: ParsedGuidelines,
): { profile: BrandProfile; updatedFields: string[] } {
  const next: Record<string, unknown> = { ...profile };
  const updatedFields: string[] = [];
  for (const key of parsed.present) {
    const value = parsed.fields[key];
    if (JSON.stringify(value ?? null) === JSON.stringify(next[key] ?? null)) continue;
    if (value === undefined) delete next[key];
    else next[key] = value;
    updatedFields.push(key);
  }
  const checked = brandProfileSchema.safeParse(next);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new Error(`${issue?.path.join(".") ?? "profile"}: ${issue?.message ?? "invalid"}`);
  }
  return { profile: checked.data, updatedFields };
}

/** PDF header: the logo, then a row of colour swatches with their hex codes. */
export function drawBrandHeader(
  doc: InstanceType<typeof PDFDocument>,
  brand: { logo: Buffer | null; colors: string[] },
): void {
  const left = doc.page.margins.left;
  if (brand.logo) {
    try {
      doc.image(brand.logo, left, doc.y, { fit: [150, 64] });
      doc.y += 76;
    } catch {
      // PDFKit only reads PNG/JPEG; skip other logo formats
    }
  }
  if (brand.colors.length) {
    const top = doc.y;
    brand.colors.slice(0, 6).forEach((hex, i) => {
      const x = left + i * 74;
      doc.roundedRect(x, top, 64, 40, 6).fillAndStroke(hex, "#dddddd");
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#555555")
        .text(hex.toUpperCase(), x, top + 45, { width: 64, align: "center" });
    });
    doc.x = left;
    doc.y = top + 68;
  }
}

/** Human labels for the fields a save changed. */
export const FIELD_LABEL: Record<string, string> = Object.fromEntries(STRUCTURED_SECTIONS.map((s) => [s.key, s.title]));
