import { createHash } from "node:crypto";
import type { ImageSize, ImageStyle, VisualBrief } from "@catgpt/types";

/**
 * Pure rules behind intelligent image generation: understand the request
 * (occasion, style, aspect, required objects), turn it into a detailed
 * visual brief, and decide which stored images are genuinely relevant enough
 * to be used as references. No I/O here — the LLM-backed analyser in
 * services/image-brief.ts merges its answer over `heuristicBrief`, and the
 * worker/route call the selection helpers.
 */

export interface OccasionProfile {
  id: string;
  label: string;
  keywords: RegExp;
  motifs: string[];
  palette: string[];
  background: string;
  culturalContext: string | null;
  avoid: string[];
  defaultStyle: Exclude<ImageStyle, "auto">;
}

/** Order matters: more specific occasions come before generic ones. */
export const OCCASIONS: OccasionProfile[] = [
  {
    id: "engagement",
    label: "Engagement",
    keywords: /\b(engagement|engaged|ring ceremony|roka|sagai|nischitartham|nishchay|proposal)\b/i,
    motifs: ["engagement rings on a velvet tray", "fresh floral arrangements", "soft fairy lights", "romantic decor"],
    palette: ["blush pink", "ivory", "gold"],
    background: "an elegant, softly lit ceremony setting with floral decor",
    culturalContext: null,
    avoid: ["wedding cake", "birthday balloons"],
    defaultStyle: "realistic",
  },
  {
    id: "wedding",
    label: "Wedding",
    keywords: /\b(wedding|marriage|shaadi|kalyanam|vivah|bride|bridal|groom|mandap|reception)\b/i,
    motifs: ["wedding stage or mandap", "lush floral arrangements", "draped fabrics", "warm decorative lighting"],
    palette: ["ivory", "gold", "deep red"],
    background: "an elegant, richly decorated wedding venue",
    culturalContext: null,
    avoid: ["birthday cake", "balloons with numbers"],
    defaultStyle: "realistic",
  },
  {
    id: "birthday",
    label: "Birthday",
    keywords: /\b(birthday|b'?day|bday|turning \d+|\d+(?:st|nd|rd|th) birthday)\b/i,
    motifs: ["birthday cake with lit candles", "balloons", "confetti", "party decorations"],
    palette: ["vibrant pastel", "gold", "white"],
    background: "a cheerful, festive party setting",
    culturalContext: null,
    avoid: ["wedding decor"],
    defaultStyle: "realistic",
  },
  {
    id: "anniversary",
    label: "Anniversary",
    keywords: /\b(anniversary)\b/i,
    motifs: ["roses", "candles", "champagne glasses", "elegant table setting"],
    palette: ["deep red", "gold", "cream"],
    background: "a romantic, warmly lit setting",
    culturalContext: null,
    avoid: ["birthday balloons"],
    defaultStyle: "cinematic",
  },
  {
    id: "diwali",
    label: "Diwali",
    keywords: /\b(diwali|deepavali|deepawali|dipawali|festival of lights)\b/i,
    motifs: ["glowing clay diyas", "colourful rangoli", "string lights", "marigold garlands", "lanterns"],
    palette: ["saffron", "gold", "deep maroon", "warm amber glow"],
    background: "a festive night scene glowing with lamps and lights",
    culturalContext: "Indian Hindu festival of lights",
    avoid: ["christmas trees", "snow"],
    defaultStyle: "traditional",
  },
  {
    id: "sankranti",
    label: "Sankranti / Pongal",
    keywords: /\b(sankranti|sankranthi|makar|pongal|lohri|uttarayan|bhogi|kite festival)\b/i,
    motifs: ["colourful kites in a clear sky", "sugarcane", "pongal pot", "harvest produce", "rangoli / muggulu"],
    palette: ["sunny yellow", "orange", "green", "sky blue"],
    background: "a bright, sunny harvest-festival scene",
    culturalContext: "Indian harvest festival",
    avoid: ["christmas trees", "snow", "fireworks at night"],
    defaultStyle: "traditional",
  },
  {
    id: "dasara",
    label: "Dasara / Navratri",
    keywords: /\b(dasara|dussehra|dasha?ra|vijaya ?dashami|navratri|navaratri|durga puja|bathukamma|golu|bommala koluvu)\b/i,
    motifs: ["marigold and flower decorations", "traditional brass lamps", "festive torans", "cultural motifs"],
    palette: ["red", "saffron", "gold", "green"],
    background: "a vibrant traditional festive setting",
    culturalContext: "Indian festival celebrating the victory of good over evil",
    avoid: ["christmas trees", "halloween"],
    defaultStyle: "traditional",
  },
  {
    id: "holi",
    label: "Holi",
    keywords: /\b(holi)\b/i,
    motifs: ["clouds of coloured powder (gulal)", "water splashes", "bright festive colours"],
    palette: ["magenta", "yellow", "green", "blue"],
    background: "an exuberant outdoor scene bursting with colour",
    culturalContext: "Indian festival of colours",
    avoid: ["snow"],
    defaultStyle: "realistic",
  },
  {
    id: "eid",
    label: "Eid",
    keywords: /\b(eid|ramadan|ramzan|iftar)\b/i,
    motifs: ["crescent moon", "ornate lanterns", "dates and festive sweets", "geometric patterns"],
    palette: ["emerald green", "gold", "midnight blue"],
    background: "a serene evening scene with lanterns",
    culturalContext: "Islamic festival",
    avoid: ["alcohol", "pork"],
    defaultStyle: "traditional",
  },
  {
    id: "christmas",
    label: "Christmas",
    keywords: /\b(christmas|xmas|x-mas|santa|noel)\b/i,
    motifs: ["decorated Christmas tree", "wrapped gifts", "snow", "ornaments and fairy lights"],
    palette: ["red", "green", "gold", "white"],
    background: "a cosy, festive winter setting",
    culturalContext: "Christian / western holiday",
    avoid: ["diyas", "rangoli"],
    defaultStyle: "realistic",
  },
  {
    id: "new_year",
    label: "New Year",
    keywords: /\b(new ?year|nye|happy 20\d\d|20\d\d celebration|countdown)\b/i,
    motifs: ["fireworks", "champagne", "confetti", "elegant party lights"],
    palette: ["gold", "black", "silver"],
    background: "a glamorous night celebration with fireworks",
    culturalContext: null,
    avoid: [],
    defaultStyle: "cinematic",
  },
  {
    id: "valentines",
    label: "Valentine's Day",
    keywords: /\b(valentine'?s?)\b/i,
    motifs: ["red roses", "hearts", "chocolates", "soft candlelight"],
    palette: ["red", "pink", "white"],
    background: "a romantic, softly lit setting",
    culturalContext: null,
    avoid: [],
    defaultStyle: "realistic",
  },
  {
    id: "food",
    label: "Food",
    keywords: /\b(food|dish|meal|menu|biryani|pizza|burger|cake|dessert|restaurant|cafe|coffee|recipe|thali|dosa|curry|snack|bakery|breakfast|lunch|dinner)\b/i,
    motifs: ["the dish as the hero", "appetising garnish", "complementary props and ingredients"],
    palette: ["warm natural tones"],
    background: "a styled table surface with shallow depth of field",
    culturalContext: null,
    avoid: ["inedible-looking food", "messy plating"],
    defaultStyle: "realistic",
  },
  {
    id: "product",
    label: "Product promotion",
    keywords: /\b(product|launch|promo(?:tion)?|advert(?:isement)?|ad\b|sale|offer|discount|packshot|e-?commerce|merch)\b/i,
    motifs: ["the product as the clear hero", "clean studio lighting", "subtle reflections and props"],
    palette: ["clean neutrals with one accent colour"],
    background: "a clean, professional studio backdrop",
    culturalContext: null,
    avoid: ["clutter that competes with the product"],
    defaultStyle: "modern",
  },
  {
    id: "business",
    label: "Business",
    keywords: /\b(business|corporate|office|company|startup|conference|meeting|team|b2b|linkedin|professional|finance|consulting)\b/i,
    motifs: ["modern professional environment", "clean corporate design elements"],
    palette: ["navy", "white", "teal accent"],
    background: "a bright, modern office or abstract corporate backdrop",
    culturalContext: null,
    avoid: ["cartoonish elements"],
    defaultStyle: "modern",
  },
];

export function occasionById(id: string | null | undefined): OccasionProfile | null {
  if (!id) return null;
  return OCCASIONS.find((o) => o.id === id) ?? null;
}

/** First matching occasion (catalogue order = priority), or null. */
export function detectOccasion(prompt: string): OccasionProfile | null {
  return OCCASIONS.find((o) => o.keywords.test(prompt)) ?? null;
}

const STYLE_PATTERNS: [Exclude<ImageStyle, "auto">, RegExp][] = [
  ["3d", /\b(3d|3-d|render(?:ed)? in 3d|pixar|clay ?render|isometric)\b/i],
  ["cinematic", /\b(cinematic|movie|film(?:ic)?|dramatic lighting)\b/i],
  ["artistic", /\b(artistic|painting|watercolou?r|oil paint|illustration|illustrated|sketch|vector|cartoon|anime|abstract)\b/i],
  ["traditional", /\b(traditional|ethnic|heritage|classical|vintage|cultural)\b/i],
  ["modern", /\b(modern|minimal(?:ist)?|sleek|flat design|contemporary)\b/i],
  ["realistic", /\b(realistic|photo(?:graph)?(?:ic|y)?|photorealistic|real[- ]life|lifelike)\b/i],
];

export function detectStyle(
  prompt: string,
  explicit?: ImageStyle | null,
): Exclude<ImageStyle, "auto"> | null {
  if (explicit && explicit !== "auto") return explicit;
  return STYLE_PATTERNS.find(([, re]) => re.test(prompt))?.[0] ?? null;
}

export function detectAspect(prompt: string): VisualBrief["aspect"] | null {
  if (/\b(portrait|vertical|story|stories|reel|9:16|4:5|2:3|poster|flyer|whatsapp status)\b/i.test(prompt)) return "portrait";
  if (/\b(landscape|horizontal|banner|cover photo|header|16:9|3:2|wide(?:screen)?|youtube thumbnail)\b/i.test(prompt)) return "landscape";
  if (/\b(square|1:1|instagram post|profile pic(?:ture)?|dp)\b/i.test(prompt)) return "square";
  return null;
}

/** Explicit user size wins; otherwise map the inferred aspect to a size. */
export function sizeForAspect(
  requested: ImageSize | undefined,
  aspect: VisualBrief["aspect"] | null,
): ImageSize {
  if (requested && requested !== "auto") return requested;
  if (aspect === "portrait") return "1024x1536";
  if (aspect === "landscape") return "1536x1024";
  if (aspect === "square") return "1024x1024";
  return "auto";
}

export function aspectForSize(size: ImageSize | undefined): VisualBrief["aspect"] | null {
  if (size === "1024x1024") return "square";
  if (size === "1024x1536" || size === "1088x1360") return "portrait";
  if (size === "1536x1024") return "landscape";
  return null;
}

/** Words on the image only when the user actually asked for them. */
export function wantsOnImageText(prompt: string): boolean {
  return (
    /["“”'‘’][^"“”'‘’]{2,}["“”'‘’]/.test(prompt) ||
    /\b(text|caption|headline|title|tagline|quote|wish(?:es)?|greeting|says?|saying|written|write|lettering|typography|name on|with the words?)\b/i.test(prompt)
  );
}

const STOP_WORDS = new Set(
  "a an and the of for to with in on at by from into over under as is are be this that these those it its my our your their image images picture pictures photo photos poster create make generate design draw render show give me please beautiful nice good high quality new some very really".split(" "),
);

/** Lower-case content words (len ≥ 3, no stop words), de-duplicated. */
export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** Concrete objects named in the prompt, e.g. "with red roses, golden lighting and an elegant background". */
export function extractRequiredObjects(prompt: string): string[] {
  const m = prompt.match(/\b(?:with|featuring|including|having|showing)\b([^.?!]*)/i);
  if (!m) return [];
  return m[1]!
    .split(/,|\band\b|&/i)
    .map((s) => s.replace(/^\s*(?:an?|the|some)\s+/i, "").trim())
    .filter((s) => s.length > 2 && s.length < 80)
    .slice(0, 8);
}

/**
 * Brand mode: the brand palette leads; occasion colours survive only as a
 * couple of labelled accents so the festival never re-colours the brand.
 */
export function brandFirstColors(brandColors: string[] | undefined, occasionColors: string[]): string[] {
  if (!brandColors?.length) return occasionColors;
  return [
    ...brandColors.map((c) => c.toUpperCase()),
    ...occasionColors.slice(0, 2).map((c) => `${c} (small accent only)`),
  ];
}

/** Offline brief — used alone when no chat model is available, and as the floor the LLM answer is merged over. */
export function heuristicBrief(
  prompt: string,
  opts: { style?: ImageStyle | null; size?: ImageSize } = {},
): VisualBrief {
  const occ = detectOccasion(prompt);
  const style = detectStyle(prompt, opts.style) ?? occ?.defaultStyle ?? "realistic";
  const aspect = aspectForSize(opts.size) ?? detectAspect(prompt) ?? "square";
  const named = extractRequiredObjects(prompt);
  const required = [...new Set([...named, ...(occ?.motifs.slice(0, 3) ?? [])])].slice(0, 8);
  const subject = prompt.trim().split(/[.\n]/)[0]!.slice(0, 160);
  const brief: VisualBrief = {
    subject,
    occasion: occ?.id ?? null,
    theme: occ ? `${occ.label} celebration` : subject,
    style,
    background: occ?.background ?? "a clean background that suits the subject",
    colors: occ?.palette ?? [],
    culturalContext: occ?.culturalContext ?? null,
    requiredObjects: required,
    aspect,
    wantsText: wantsOnImageText(prompt),
    avoid: occ?.avoid ?? [],
    visualDescription: "",
    source: "heuristic",
  };
  brief.visualDescription = describeScene(brief, prompt);
  return brief;
}

const STYLE_DIRECTIVES: Record<Exclude<ImageStyle, "auto">, string> = {
  realistic: "photorealistic, natural lighting, true-to-life textures, sharp focus, shot on a professional camera",
  cinematic: "cinematic composition, dramatic but clean lighting, rich colour grading, shallow depth of field",
  traditional: "traditional, culturally authentic decor and craftsmanship, rich ornate detail, warm festive lighting",
  modern: "modern, clean and minimal composition, contemporary design, crisp lighting, generous negative space",
  "3d": "high-quality 3D render, soft global illumination, smooth materials, subtle depth of field",
  artistic: "artistic illustration with a cohesive painterly style, expressive yet polished",
};

export function describeScene(brief: VisualBrief, userPrompt: string): string {
  const parts = [
    `${userPrompt.trim().replace(/\s+/g, " ")}.`,
    brief.requiredObjects.length ? `Must clearly show: ${brief.requiredObjects.join(", ")}.` : "",
    `Setting/background: ${brief.background}.`,
    brief.colors.length ? `Colour palette: ${brief.colors.join(", ")}.` : "",
    brief.culturalContext ? `Cultural context: ${brief.culturalContext} — keep every detail authentic and respectful.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * The directive block appended to the image prompt. It is deliberately
 * specific — every element the user asked for is restated as a requirement
 * so the model can't fall back to a generic picture of the occasion.
 */
export function briefPrompt(brief: VisualBrief, variation?: { index: number } | null): string {
  const lines = [
    "\nCreative brief (follow precisely):",
    `- Scene: ${brief.visualDescription}`,
    `- Main subject: ${brief.subject}.`,
    brief.occasion ? `- Occasion: ${occasionById(brief.occasion)?.label ?? brief.occasion}. Use visuals specific to this occasion, not generic stock imagery.` : "",
    brief.requiredObjects.length ? `- Required elements (all must be visible): ${brief.requiredObjects.join("; ")}.` : "",
    `- Style: ${STYLE_DIRECTIVES[brief.style]}.`,
    `- Composition: ${brief.aspect} framing; keep the main subject fully inside the frame.`,
    brief.avoid.length ? `- Avoid: ${brief.avoid.join(", ")}.` : "",
    brief.wantsText
      ? "- Render only the text the user asked for, spelled exactly, crisp and legible."
      : "- Do not add any text, letters, captions, logos or watermarks to the image.",
    "- Quality: high detail, sharp, no blur, no distorted anatomy or warped objects, no duplicated elements, consistent lighting and colours throughout.",
    variation
      ? `- This is a fresh variation (#${variation.index + 1}) of an earlier image: keep the same brief but use a clearly different composition, camera angle and arrangement.`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Per-image diversity hint for multi-image sets so the set isn't repetitive. */
export const VARIATION_ANGLES = [
  "wide establishing view",
  "close-up detail shot",
  "eye-level centred composition",
  "elevated three-quarter angle",
  "asymmetric composition with the subject off-centre",
  "top-down flat-lay view",
];

/* -------------------------- reference image curation ------------------------- */

export type ReferenceCandidate = {
  url: string;
  /** brand asset kind (product, mascot, reference) or "theme". */
  kind: string;
  label?: string | null;
};

/**
 * Relevance of a stored image to the brief, 0..1. A stored image is only
 * worth sending to the model when its label shares real content words with
 * the request — unlabeled dump images score 0 and are never used.
 */
export function referenceRelevance(
  brief: Pick<VisualBrief, "subject" | "theme" | "requiredObjects" | "occasion">,
  prompt: string,
  candidate: ReferenceCandidate,
): number {
  const label = candidate.label?.trim();
  if (!label) return 0;
  const want = new Set(
    keywords([prompt, brief.subject, brief.theme, ...brief.requiredObjects, brief.occasion ?? ""].join(" ")),
  );
  const have = keywords(label);
  if (have.length === 0) return 0;
  const hits = have.filter((w) => want.has(w) || [...want].some((x) => x.length >= 5 && (x.startsWith(w) || w.startsWith(x)))).length;
  return hits / have.length;
}

/** Does the request involve the brand's own product (so product photos are relevant)? */
export function mentionsProduct(prompt: string): boolean {
  return /\b(our|my|the brand'?s?)\s+(?:\w+\s+){0,2}(product|products|item|items|dish|dishes|bottle|pack|packaging|menu)\b|\bproduct (?:shot|photo|ad|promotion|launch)\b|\bpackshot\b/i.test(prompt);
}

/** Real product photos a brand image carries when the prompt names none. */
export const MAX_BRAND_PRODUCTS = 2;

/**
 * Pick only the stored images that genuinely match the request. Mascot is
 * used only when the prompt mentions it; product photos only for product
 * requests or a label match; theme/reference images only on a label match.
 */
export function selectRelevantReferences(
  brief: VisualBrief,
  prompt: string,
  candidates: ReferenceCandidate[],
  opts: { threshold?: number; max?: number; brandMode?: boolean } = {},
): { selected: ReferenceCandidate[]; rejected: ReferenceCandidate[] } {
  const threshold = opts.threshold ?? 0.5;
  const max = opts.max ?? 4;
  const scored = candidates.map((c) => {
    let score = referenceRelevance(brief, prompt, c);
    if (c.kind === "product" && (mentionsProduct(prompt) || brief.occasion === "product")) score = Math.max(score, 0.75);
    if (c.kind === "mascot" && /\bmascot\b/i.test(prompt)) score = 1;
    return { c, score };
  });
  // Brand mode: a brand image always shows the brand's REAL products (never
  // invented ones) - the best label matches first, capped so the scene stays
  // clean. Candidate order (newest first) breaks ties.
  const brandProducts = opts.brandMode
    ? scored
        .filter((s) => s.c.kind === "product")
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_BRAND_PRODUCTS)
    : [];
  const forced = new Set(brandProducts.map((s) => s.c.url));
  const selected = [
    ...brandProducts,
    ...scored
      .filter((s) => !forced.has(s.c.url) && s.score >= threshold)
      .sort((a, b) => b.score - a.score),
  ]
    .slice(0, max)
    .map((s) => s.c);
  const keep = new Set(selected.map((c) => c.url));
  return { selected, rejected: candidates.filter((c) => !keep.has(c.url)) };
}

/* ------------------------------- request reuse ------------------------------ */

/** Stable fingerprint of everything that determines the image output. */
export function imageRequestHash(parts: {
  prompt: string;
  brandId?: string | null;
  themeId?: string | null;
  style?: string | null;
  size?: string | null;
  quality?: string | null;
  imageCount?: number;
  references?: string[];
}): string {
  const norm = {
    // Pipeline version: bump when brand handling changes so results made by an
    // older pipeline (e.g. without the brand identity) are never reused.
    v: 2,
    p: parts.prompt.trim().toLowerCase().replace(/\s+/g, " "),
    b: parts.brandId ?? null,
    t: parts.themeId ?? null,
    s: parts.style ?? "auto",
    z: parts.size ?? "auto",
    q: parts.quality ?? "low",
    n: parts.imageCount ?? 1,
    r: [...(parts.references ?? [])].sort(),
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 32);
}

/** Order images by relevance score (highest first); unscored keep their order at the end. */
export function rankByScore<T>(items: T[], scores: (number | null)[]): T[] {
  return items
    .map((item, i) => ({ item, i, s: scores[i] ?? -1 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
