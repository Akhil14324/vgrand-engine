import { createHash } from "node:crypto";
import { z } from "zod";
import { SHORTS_HOOK_TYPES, type ShortsStyleNotes } from "@catgpt/types";

/**
 * Path B idea + script: prompt construction, the JSON shape requested from the
 * model, and the checks a script must pass before it is used.
 */

/** Typical narration pace for short-form voiceover (ElevenLabs default speed). */
export const WORDS_PER_SECOND = 2.6;
export const MIN_NARRATION_SEC = 15;
export const MAX_NARRATION_SEC = 40;
export const MAX_TITLE_CHARS = 70;
export const MAX_HOOK_WORDS = 8;

export const scriptOutputSchema = z.object({
  topic: z.string().min(2).max(120),
  hookType: z.enum(SHORTS_HOOK_TYPES),
  hook: z.string().min(2).max(160),
  beats: z
    .array(
      z.object({
        narration: z.string().min(2).max(400),
        searchQueries: z.array(z.string().min(2).max(60)).min(1).max(4),
      }),
    )
    .min(2)
    .max(8),
  title: z.string().min(3).max(100),
  description: z.string().min(10).max(2000),
  tags: z.array(z.string().min(1).max(40)).min(3).max(15),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

/** JSON Schema sent as output_config.format. Kept to the subset structured outputs supports. */
export const SCRIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "hookType", "hook", "beats", "title", "description", "tags"],
  properties: {
    topic: { type: "string", description: "The specific subject of this Short, a few words." },
    hookType: { type: "string", enum: [...SHORTS_HOOK_TYPES] },
    hook: { type: "string", description: `Spoken in the first 2 seconds. At most ${MAX_HOOK_WORDS} words.` },
    beats: {
      type: "array",
      description: "The narration after the hook, split into 2-8 beats. Each beat gets its own stock clip.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "searchQueries"],
        properties: {
          narration: { type: "string" },
          searchQueries: {
            type: "array",
            description: "1-3 short, literal stock-footage search queries (2-4 words, nouns and actions, no names).",
            items: { type: "string" },
          },
        },
      },
    },
    title: { type: "string", description: `Under ${MAX_TITLE_CHARS} characters, no hashtags.` },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
} as const;

export interface ScriptPromptInput {
  channelName: string;
  niche: string;
  styleNotes: ShortsStyleNotes;
  recentTitles: string[];
  /** Set on a retry after a duplicate or failed check. */
  avoidNote?: string | null;
}

export function buildScriptPrompt(input: ScriptPromptInput): { system: string; user: string } {
  const s = input.styleNotes;
  const minWords = Math.ceil(MIN_NARRATION_SEC * WORDS_PER_SECOND);
  const maxWords = Math.floor(MAX_NARRATION_SEC * WORDS_PER_SECOND);
  const system = [
    `You write original scripts for a YouTube Shorts channel called "${input.channelName}" (niche: ${input.niche}).`,
    "Every Short is narrated by a voiceover over licensed stock footage, so the script must carry the value on its own:",
    "a real fact, a mini-story, a tip or a joke the viewer did not know. Never describe or retell another creator's video.",
    `Tone: ${s.tone || "natural and specific"}.`,
    s.hookPatterns?.length ? `Hook patterns that fit this channel: ${s.hookPatterns.join("; ")}.` : "",
    s.bannedTopics?.length ? `Never touch these topics: ${s.bannedTopics.join("; ")}.` : "",
    s.extra ? `Other notes: ${s.extra}` : "",
    "Only state facts you are confident are true; prefer widely documented facts over surprising-but-shaky ones.",
    "Do not mention that footage is stock, and do not ask viewers to like or subscribe in the narration.",
  ]
    .filter(Boolean)
    .join("\n");

  const recent = input.recentTitles.length
    ? `Titles already used on this channel (do not repeat these topics, angles or hooks):\n${input.recentTitles.map((t) => `- ${t}`).join("\n")}`
    : "This channel has no previous videos.";

  const user = [
    "Write one new Short.",
    `Total spoken words (hook + all beats): ${minWords}-${maxWords} words, i.e. ${MIN_NARRATION_SEC}-${MAX_NARRATION_SEC} seconds.`,
    `The hook is spoken first and must work in under 2 seconds (at most ${MAX_HOOK_WORDS} words).`,
    "Split the rest into 2-8 beats; each beat is one or two sentences and needs its own visual.",
    "searchQueries must be literal things a camera could film (e.g. 'cat stretching', 'kitten paw close up').",
    `Title under ${MAX_TITLE_CHARS} characters. Description 1-3 sentences. 5-12 tags without '#'.`,
    recent,
    input.avoidNote ? `Important: ${input.avoidNote}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

export const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Full narration text in speaking order. */
export const narrationOf = (s: Pick<ScriptOutput, "hook" | "beats">) =>
  [s.hook, ...s.beats.map((b) => b.narration)].map((t) => t.trim()).join(" ");

export function estimateNarrationSec(text: string): number {
  return countWords(text) / WORDS_PER_SECOND;
}

/** Problems that make a script unusable. Empty means it passes. */
export function scriptProblems(s: ScriptOutput, bannedTopics: string[] = []): string[] {
  const problems: string[] = [];
  if (s.title.length >= MAX_TITLE_CHARS) problems.push(`title is ${s.title.length} characters (must be under ${MAX_TITLE_CHARS})`);
  if (countWords(s.hook) > MAX_HOOK_WORDS) problems.push(`hook is ${countWords(s.hook)} words (max ${MAX_HOOK_WORDS})`);
  const sec = estimateNarrationSec(narrationOf(s));
  if (sec < MIN_NARRATION_SEC) problems.push(`narration is about ${sec.toFixed(0)}s (min ${MIN_NARRATION_SEC}s)`);
  if (sec > MAX_NARRATION_SEC) problems.push(`narration is about ${sec.toFixed(0)}s (max ${MAX_NARRATION_SEC}s)`);
  const lower = `${s.title} ${narrationOf(s)}`.toLowerCase();
  for (const b of bannedTopics) {
    const word = b.toLowerCase().trim();
    // Only single words / short phrases are checked literally; long descriptions are left to the prompt.
    if (word && word.split(/\s+/).length <= 2 && new RegExp(`\\b${escapeRe(word)}\\b`).test(lower)) {
      problems.push(`mentions banned topic "${b}"`);
    }
  }
  return problems;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Normalised narration hash: case, punctuation and spacing don't make a script "new". */
export function scriptHash(narration: string): string {
  const norm = narration
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(norm).digest("hex");
}

/** Tags cleaned for YouTube: no '#', unique, total under YouTube's 500-character limit. */
export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of tags) {
    const t = raw.replace(/#/g, "").replace(/[<>,]/g, "").trim();
    if (!t || out.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
    if (total + t.length + 1 > 480) break;
    out.push(t);
    total += t.length + 1;
  }
  return out;
}
