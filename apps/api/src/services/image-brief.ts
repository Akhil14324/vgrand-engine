import { z } from "zod";
import {
  IMAGE_STYLES,
  type ImageSize,
  type ImageStyle,
  type VisualBrief,
} from "@catgpt/types";
import { env } from "../env.js";
import { getClient } from "./chat.js";
import {
  OCCASIONS,
  aspectForSize,
  brandFirstColors,
  describeScene,
  heuristicBrief,
} from "../lib/image-brief-logic.js";

/**
 * Step 1 of intelligent image generation: understand the request before any
 * pixels are made. One small JSON chat call extracts subject, occasion, theme,
 * style, background, colours, cultural context, required objects and aspect;
 * the result is merged over the offline heuristic so a missing key, timeout or
 * malformed answer degrades to the heuristic instead of failing the job.
 */

const llmBriefSchema = z.object({
  subject: z.string().min(1).max(300),
  occasion: z.string().max(60).nullable().optional(),
  theme: z.string().max(200).optional(),
  style: z.enum(IMAGE_STYLES).optional(),
  background: z.string().max(300).optional(),
  colors: z.array(z.string().max(40)).max(8).optional(),
  culturalContext: z.string().max(200).nullable().optional(),
  requiredObjects: z.array(z.string().max(100)).max(10).optional(),
  aspect: z.enum(["square", "portrait", "landscape"]).nullable().optional(),
  wantsText: z.boolean().optional(),
  avoid: z.array(z.string().max(80)).max(8).optional(),
  visualDescription: z.string().max(1500).optional(),
});

const SYSTEM = `You are the art director of an AI image studio. Analyse the user's image request and return ONLY a JSON object with:
subject (main subject, concise), occasion (one of: ${OCCASIONS.map((o) => o.id).join(", ")}; or a short custom label; or null), theme (the visual concept), style (one of: realistic, cinematic, traditional, modern, 3d, artistic — pick what fits if the user didn't say), background, colors (array), culturalContext (or null), requiredObjects (array — EVERY concrete element the user named, plus the 2-4 most characteristic props for the occasion), aspect (square | portrait | landscape | null if not implied), wantsText (true only if the user asked for words/text on the image), avoid (things that would make the image off-brief or culturally wrong), visualDescription (3-5 sentences describing one specific, vivid scene that satisfies every detail of the request — never generic).
Respect the user's specifics over occasion defaults (e.g. "red roses and golden lighting" must appear exactly). Do not invent brand names, people or text the user did not ask for.`;

const BRAND_SYSTEM = `${SYSTEM}
BRAND MODE: the request is for the brand described in "Brand context". The brand identity is fixed: its palette is the dominant colour scheme (list the brand colour codes first in "colors"; occasion colours only as small accents), its real products are the hero of the scene (name them in requiredObjects; never invent other products or packaging), and its visual style governs the look. The occasion only changes the theme, background and decorations. Never describe a logo, emblem or brand lettering in the scene - the real logo is added afterwards; leave one corner calm for it. Make it a professional advertising composition.`;

export async function analyzeImagePrompt(
  prompt: string,
  opts: {
    style?: ImageStyle | null;
    size?: ImageSize;
    themeLabel?: string | null;
    brandSummary?: string | null;
    /** A brand is selected: its identity (palette, real products) leads the brief. */
    brandMode?: boolean;
    /** The selected brand's exact colour codes. */
    brandColors?: string[];
    previousBrief?: VisualBrief | null;
  } = {},
): Promise<VisualBrief> {
  const base = withBrand(heuristicBrief(prompt, { style: opts.style, size: opts.size }), opts, prompt);
  if (!env.OPENAI_API_KEY) return base;
  try {
    const res = await getClient().chat.completions.create(
      {
        model: env.CHAT_MODEL,
        temperature: 0.3,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.brandMode ? BRAND_SYSTEM : SYSTEM },
          {
            role: "user",
            content: [
              `Request: ${prompt.slice(0, 3000)}`,
              opts.style && opts.style !== "auto" ? `Requested style: ${opts.style}` : "",
              opts.themeLabel ? `Studio theme: ${opts.themeLabel}` : "",
              opts.brandSummary
                ? opts.brandMode
                  ? `Brand context (the selected brand - its identity must drive the image):\n${opts.brandSummary.slice(0, 1400)}`
                  : `Brand context (for tone only):\n${opts.brandSummary.slice(0, 800)}`
                : "",
              opts.previousBrief
                ? `This is a "generate again" request. Previous scene: ${opts.previousBrief.visualDescription.slice(0, 600)}\nKeep the same brief but describe a clearly different composition.`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
      { timeout: 15_000 },
    );
    const raw = res.choices[0]?.message.content;
    if (!raw) return base;
    const parsed = llmBriefSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return base;
    return withBrand(mergeBrief(base, parsed.data, opts, prompt), opts, prompt);
  } catch (err) {
    console.warn(
      "[image-brief] analysis fell back to heuristic:",
      err instanceof Error ? err.message : err,
    );
    return base;
  }
}

/** Brand mode: brand palette first (occasion colours as accents), scene re-described to match. */
function withBrand(
  brief: VisualBrief,
  opts: { brandMode?: boolean; brandColors?: string[] },
  prompt: string,
): VisualBrief {
  if (!opts.brandMode || !opts.brandColors?.length) return brief;
  const brandUpper = new Set(opts.brandColors.map((c) => c.toUpperCase()));
  const others = brief.colors.filter((c) => !brandUpper.has(c.toUpperCase()) && !/accent only/.test(c));
  const next = { ...brief, colors: brandFirstColors(opts.brandColors, others) };
  if (brief.source === "heuristic") next.visualDescription = describeScene(next, prompt);
  return next;
}

function mergeBrief(
  base: VisualBrief,
  llm: z.infer<typeof llmBriefSchema>,
  opts: { style?: ImageStyle | null; size?: ImageSize },
  prompt: string,
): VisualBrief {
  const knownOccasion = llm.occasion
    ? OCCASIONS.find(
        (o) => o.id === llm.occasion!.toLowerCase().replace(/[\s'-]+/g, "_") || o.label.toLowerCase() === llm.occasion!.toLowerCase(),
      )?.id
    : null;
  // The user's explicit choices always beat the model's guess.
  const style =
    opts.style && opts.style !== "auto"
      ? opts.style
      : llm.style && llm.style !== "auto"
        ? llm.style
        : base.style;
  const merged: VisualBrief = {
    subject: llm.subject || base.subject,
    occasion: knownOccasion ?? llm.occasion ?? base.occasion,
    theme: llm.theme || base.theme,
    style,
    background: llm.background || base.background,
    colors: llm.colors?.length ? llm.colors : base.colors,
    culturalContext: llm.culturalContext ?? base.culturalContext,
    requiredObjects: [
      ...new Set([...(llm.requiredObjects ?? []), ...base.requiredObjects]),
    ].slice(0, 10),
    aspect: aspectForSize(opts.size) ?? llm.aspect ?? base.aspect,
    wantsText: llm.wantsText ?? base.wantsText,
    avoid: [...new Set([...(llm.avoid ?? []), ...base.avoid])].slice(0, 8),
    visualDescription: "",
    source: "llm",
  };
  merged.visualDescription =
    llm.visualDescription?.trim() || describeScene(merged, prompt);
  return merged;
}

/**
 * Step 5: does a generated image actually match the brief? A vision chat call
 * scores 0-10 and lists missing elements. Null when scoring is unavailable —
 * callers treat null as "unknown", never as a failure.
 */
export async function scoreImageRelevance(
  image: { url?: string; b64?: string },
  brief: VisualBrief,
): Promise<{ score: number; missing: string[] } | null> {
  if (!env.OPENAI_API_KEY || env.IMAGE_RELEVANCE_CHECK === "off") return null;
  const src = image.b64 ? `data:image/png;base64,${image.b64}` : image.url;
  if (!src) return null;
  try {
    const res = await getClient().chat.completions.create(
      {
        model: env.OCR_MODEL,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You check AI-generated images against a creative brief. Return ONLY JSON {"score": 0-10, "missing": [required elements that are absent or wrong]}. 10 = every required element present, correct occasion/culture, no distortion or unwanted text; 0 = unrelated image.',
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Brief: ${brief.visualDescription}\nOccasion: ${brief.occasion ?? "none"}\nRequired: ${brief.requiredObjects.join("; ") || "n/a"}\nText allowed: ${brief.wantsText ? "yes" : "no"}`,
              },
              { type: "image_url", image_url: { url: src, detail: "low" } },
            ],
          },
        ],
      },
      { timeout: 20_000 },
    );
    const out = JSON.parse(res.choices[0]?.message.content ?? "{}") as {
      score?: unknown;
      missing?: unknown;
    };
    const score = Number(out.score);
    if (!Number.isFinite(score)) return null;
    return {
      score: Math.max(0, Math.min(10, score)),
      missing: Array.isArray(out.missing)
        ? out.missing.filter((m): m is string => typeof m === "string").slice(0, 6)
        : [],
    };
  } catch (err) {
    console.warn(
      "[image-brief] relevance check skipped:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
