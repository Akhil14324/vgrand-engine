import {
  socialPreviewSchema,
  X_MAX_CHARS,
  type SocialPlatform,
  type SocialPreviewsDto,
} from "@catgpt/types";
import { env } from "../../env.js";
import { HttpError } from "../../lib/errors.js";
import { loadBrandContext } from "../../lib/brand.js";
import { getClient } from "../chat.js";

/**
 * Default look for Instagram/Facebook preview copy. Kept local (not the shared
 * SOCIAL_CAPTION_STYLE, which other flows rely on for a 2-line limit).
 */
const PREVIEW_CAPTION_STYLE =
  "Default caption format for Instagram and Facebook: an opening greeting or headline line, then 1-3 short message lines, " +
  "each line on its own, with at most one relevant emoji per line, and a contact line (phone and website) only if they appear in the context. " +
  "Keep it warm, confident and specific to this post; never salesy, generic or AI-sounding. " +
  "For X, write one line only, no greeting block.";

interface PreviewSource {
  prompt: string;
  finalPrompt: string;
  metadata: unknown;
  theme: { label: string } | null;
  /** "video" = an uploaded Reel; the copy then describes a short video, not an image. */
  kind?: string;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Per-platform shape the model must fill - only requested platforms are asked for. */
const SHAPES: Record<SocialPlatform, string> = {
  instagram:
    `"instagram": { "caption": string (default format: a short greeting or headline line, then 1-3 short message lines, one emoji per line at most, and a contact line only when a phone or website is in the context; no hashtags inside), "hashtags": string[] (5-12 relevant tags, without the # symbol) }`,
  facebook:
    `"facebook": { "caption": string (same default format as instagram: greeting or headline line, 1-3 short warm message lines, emoji accents, contact line only when present in the context) }`,
  x: `"x": { "caption": string (1 short punchy line, STRICTLY under ${X_MAX_CHARS} characters, at most 2 hashtags) }`,
  youtube:
    `"youtube": { "title": string (max 90 chars), "description": string (2-4 sentences), "tags": string[] (up to 10, no # symbol) }`,
};

/** Trim to the platform limit at a word boundary rather than reject the whole preview. */
function fitX(text: string): string {
  if (text.length <= X_MAX_CHARS) return text;
  const cut = text.slice(0, X_MAX_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 200 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * ONE chat-model call producing editable copy for every requested platform.
 * Nothing is persisted - the user edits and approves the result before any
 * SocialPost exists.
 */
export async function generateSocialPreviews(
  userId: string,
  source: PreviewSource,
  platforms: SocialPlatform[],
): Promise<SocialPreviewsDto> {
  const wanted = [...new Set(platforms)];

  const meta = (source.metadata ?? {}) as { brandId?: unknown };
  const brand =
    typeof meta.brandId === "string" ? await loadBrandContext(meta.brandId, userId) : null;

  const isVideo = source.kind === "video";
  const context = [
    isVideo
      ? `Video (a short Reel; all we know is its file name): ${clip(source.prompt, 300)}`
      : `Image idea (the user's prompt): ${clip(source.prompt, 1200)}`,
    !isVideo && source.finalPrompt && source.finalPrompt !== source.prompt
      ? `Full image brief: ${clip(source.finalPrompt, 1000)}`
      : null,
    source.theme ? `Visual theme: ${source.theme.label}` : null,
    brand?.summary ? `Brand context:\n${brand.summary}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const system =
    (isVideo
      ? `You write social media copy to accompany a short video (Reel) the user uploaded. You cannot see it, so keep the copy general to the brand and file name and never describe specific footage. `
      : `You write social media copy to accompany an AI-generated image. `) +
    `Reply with ONE JSON object containing exactly these keys and nothing else:\n` +
    `{ ${wanted.map((p) => SHAPES[p]).join(", ")} }\n` +
    `Rules: match the brand's voice when brand context is given; ` +
    `only state facts, offers, phone numbers or websites that appear in the context - never invent any. ` +
    `Language: if the brand or the idea is Telugu / Andhra Pradesh related, write the greeting and message in Telugu first, then repeat the same message in English beneath it (a clear bilingual mix). Otherwise write in the language of the image idea. ` +
    PREVIEW_CAPTION_STYLE;

  let raw: string;
  try {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: context },
      ],
    });
    raw = res.choices[0]?.message?.content ?? "";
  } catch (err) {
    console.error("[social] preview model call failed:", err instanceof Error ? err.message : err);
    throw new HttpError(502, "Could not generate the preview - try again");
  }

  let json: Record<string, any>;
  try {
    json = JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new HttpError(502, "The preview came back malformed - try again");
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown, keepSpaces = false) =>
    Array.isArray(v)
      ? [
          ...new Set(
            v
              .map((t) => str(t).replace(/^#+/, "").replace(/\s+/g, keepSpaces ? " " : "").trim())
              .filter(Boolean),
          ),
        ]
      : [];

  // Coerce into the shared schema (one source of truth for shapes and limits).
  const candidate: Record<string, unknown> = {};
  for (const p of wanted) {
    const v = (json[p] ?? {}) as Record<string, unknown>;
    if (p === "instagram") {
      candidate.instagram = { caption: str(v.caption).trim().slice(0, 2200), hashtags: list(v.hashtags).slice(0, 30) };
    } else if (p === "facebook") {
      candidate.facebook = { caption: str(v.caption).trim().slice(0, 5000) };
    } else if (p === "x") {
      candidate.x = { caption: fitX(str(v.caption).trim()) };
    } else {
      candidate.youtube = {
        title: str(v.title).trim().slice(0, 100),
        description: str(v.description).trim().slice(0, 5000),
        tags: list(v.tags, true).slice(0, 30),
      };
    }
  }
  const parsed = socialPreviewSchema.safeParse(candidate);
  if (!parsed.success) throw new HttpError(502, "The preview was incomplete - try again");
  for (const p of wanted) {
    const part = parsed.data[p] as Record<string, unknown> | undefined;
    const empty = !part || Object.values(part).every((x) => (Array.isArray(x) ? x.length === 0 : !x));
    if (empty) throw new HttpError(502, "The preview was incomplete - try again");
  }
  return parsed.data;
}
