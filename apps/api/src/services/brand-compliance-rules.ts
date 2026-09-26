import type {
  AiFindingDto,
  BrandProfile,
  ComplianceStatus,
  RuleFindingDto,
  SocialPlatform,
} from "@catgpt/types";

/**
 * Objective compliance rules: everything here is deterministic and
 * reproducible (same input -> same result). Subjective judgement (tone, style,
 * "does it look professional") lives in the AI review and is kept separate.
 */

/* ---------------------------------- text ---------------------------------- */

/** Lower-cased, punctuation and symbols become spaces, whitespace collapsed. Works for any script. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word / whole-phrase match on already-normalised text. */
function containsTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "u").test(haystack);
}

function foundTerms(text: string, terms: string[] | undefined): string[] {
  const hay = normalizeText(text);
  return (terms ?? []).filter((t) => containsTerm(hay, normalizeText(t)));
}

const quoteList = (items: string[]) => items.map((i) => `"${i}"`).join(", ");

/** Forbidden words, forbidden claims (exact phrases) and approved phrases in the given text. */
export function checkTextRules(profile: BrandProfile, text: string): RuleFindingDto[] {
  const out: RuleFindingDto[] = [];

  if (profile.forbiddenWords?.length) {
    const hits = foundTerms(text, profile.forbiddenWords);
    out.push(
      hits.length
        ? { id: "forbidden_words", label: "Forbidden words", severity: "fail", detail: `Uses ${quoteList(hits)}.` }
        : { id: "forbidden_words", label: "Forbidden words", severity: "pass", detail: "None of the brand's forbidden words appear." },
    );
  }

  if (profile.forbiddenClaims?.length) {
    const hits = foundTerms(text, profile.forbiddenClaims);
    out.push(
      hits.length
        ? { id: "forbidden_claims", label: "Forbidden claims", severity: "fail", detail: `Makes the claim ${quoteList(hits)}.` }
        : {
            id: "forbidden_claims",
            label: "Forbidden claims",
            severity: "pass",
            detail: "No forbidden claim appears word for word. Paraphrases are only caught by the AI review.",
          },
    );
  }

  if (profile.requiredPhrases?.length) {
    const hits = foundTerms(text, profile.requiredPhrases);
    out.push(
      hits.length
        ? { id: "approved_phrases", label: "Approved phrases", severity: "pass", detail: `Uses ${quoteList(hits)}.` }
        : {
            id: "approved_phrases",
            label: "Approved phrases",
            severity: "info",
            detail: `None of the approved phrases are used (${quoteList(profile.requiredPhrases.slice(0, 4))}).`,
          },
    );
  }
  return out;
}

/* --------------------------------- colours --------------------------------- */

type Lab = [number, number, number];

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Share (0-1) of visible pixels within `tolerance` (CIE76 delta-E) of each brand colour. */
export function paletteCoverage(
  colors: string[],
  rgba: Uint8ClampedArray | Uint8Array,
  tolerance = 22,
): { color: string; share: number }[] {
  const labs = colors.map((c) => {
    const rgb = hexToRgb(c);
    return rgb ? rgbToLab(...rgb) : null;
  });
  const hits = colors.map(() => 0);
  let visible = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    visible++;
    const px = rgbToLab(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    labs.forEach((lab, k) => {
      if (lab && deltaE(px, lab) <= tolerance) hits[k]!++;
    });
  }
  return colors.map((color, k) => ({ color, share: visible ? hits[k]! / visible : 0 }));
}

/** FYI only: a photo can be on-brand without containing the exact palette, so this never fails. */
export function checkPalette(colors: string[] | undefined, rgba: Uint8ClampedArray | Uint8Array): RuleFindingDto | null {
  if (!colors?.length) return null;
  const MIN_SHARE = 0.01;
  const cover = paletteCoverage(colors, rgba);
  const found = cover.filter((c) => c.share >= MIN_SHARE);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  if (found.length === 0) {
    return {
      id: "palette",
      label: "Brand colours",
      severity: "info",
      detail: `None of the brand colours stand out in the image (${colors.slice(0, 4).join(", ")}). Fine for photos; check it feels on-brand.`,
    };
  }
  return {
    id: "palette",
    label: "Brand colours",
    severity: "pass",
    detail: `Found ${found.map((c) => `${c.color} (${pct(c.share)})`).join(", ")}${found.length < colors.length ? `; not visible: ${cover.filter((c) => c.share < MIN_SHARE).map((c) => c.color).join(", ")}` : ""}.`,
  };
}

/* --------------------------------- format ---------------------------------- */

const IG_MIN = 0.8;
const IG_MAX = 1.91;

export function checkAspect(width: number, height: number, platforms: SocialPlatform[] | undefined): RuleFindingDto | null {
  if (!platforms?.includes("instagram") || !width || !height) return null;
  const ratio = width / height;
  if (ratio >= IG_MIN && ratio <= IG_MAX) {
    return { id: "instagram_format", label: "Instagram format", severity: "pass", detail: `${width}x${height} fits the Instagram feed.` };
  }
  return {
    id: "instagram_format",
    label: "Instagram format",
    severity: "info",
    detail: `${width}x${height} is outside Instagram's 4:5 to 1.91:1 range. It will be placed on a blurred background automatically when posted.`,
  };
}

/** Deterministic "logo present" signal: the brand kit stamped the real logo file. */
export function checkStampedLogo(metadata: unknown): RuleFindingDto | null {
  const m = (metadata ?? {}) as { brandKitStamped?: unknown; brandKit?: { logo?: unknown } };
  if (m.brandKitStamped === true || m.brandKit?.logo === true) {
    return { id: "logo_stamped", label: "Real logo", severity: "pass", detail: "The brand kit added the real logo file." };
  }
  return null;
}

/* --------------------------------- status ---------------------------------- */

/**
 * blocked = a hard rule failed (objective). attention = something worth a look
 * (a warning, or the AI raised a concern). pass otherwise. There is deliberately
 * no numeric score: visual brand fit is partly subjective.
 */
export function overallStatus(rules: RuleFindingDto[], ai: AiFindingDto[] | null): ComplianceStatus {
  if (rules.some((r) => r.severity === "fail")) return "blocked";
  if (rules.some((r) => r.severity === "warn") || ai?.some((a) => a.verdict === "concern")) return "attention";
  return "pass";
}
