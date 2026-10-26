import {
  GENERATED_SHOT_MAX_SEC,
  GENERATED_SHOT_MIN_SEC,
  reelScriptSchema,
  validateReelScript,
  type BrandProfile,
  type ReelBrief,
  type ReelScript,
} from "@catgpt/types";
import { checkTextRules } from "./brand-compliance-rules.js";

/** Pure script logic (no model call): prompt building, output checking, brand-rule notes. */

export interface FootageItem {
  kind: string;
  fileName: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/** One line per file so the model can cite a clip by its exact name in `sourceFile`. */
export function buildFootageInventory(items: FootageItem[]): string {
  if (items.length === 0) return "No source files were supplied. Every shot must be generate or motion_graphic.";
  return items
    .map((item) => {
      const size = item.width && item.height ? ` ${item.width}x${item.height}` : "";
      const length = item.kind === "video" && item.durationSec !== null ? ` ${item.durationSec}s` : "";
      return `- ${item.kind} "${item.fileName}"${length}${size}`;
    })
    .join("\n");
}

/** Brand words and claims the script must avoid, taken from the brand profile. */
export function forbiddenTermsLine(profile: BrandProfile | null): string {
  const words = profile?.forbiddenWords ?? [];
  const claims = profile?.forbiddenClaims ?? [];
  if (words.length === 0 && claims.length === 0) return "none listed";
  return [
    words.length ? `words: ${words.join(", ")}` : null,
    claims.length ? `claims: ${claims.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

const SCRIPT_SYSTEM_PROMPT = [
  "You write short vertical reel scripts for a brand, as a shot list with timing.",
  "Return JSON only, shaped as {\"title\",\"hook\",\"cta\",\"shots\":[{\"id\",\"startSec\",\"endSec\",\"kind\",\"description\",\"voiceover\",\"onScreenText\",\"sourceFile\"}]}.",
  "Timing: shots must start at 0, run back to back with no gaps or overlaps, and end exactly at the reel length.",
  `kind "footage": cut in a supplied source file. Set sourceFile to its exact file name. Use footage wherever a supplied clip fits the shot.`,
  `kind "generate": a shot with no matching footage. Its length must be ${GENERATED_SHOT_MIN_SEC} to ${GENERATED_SHOT_MAX_SEC} seconds. Describe the visual concretely.`,
  "kind \"motion_graphic\": titles, lower thirds or the closing call-to-action card. Use sparingly.",
  "voiceover: a short spoken line that fits the shot length (at most about 2.5 words per second), or null for a silent shot. No quotation marks.",
  "onScreenText: at most six words, or null.",
  "The hook must land in the first two seconds.",
  "Never invent prices, discounts, awards, testimonials, statistics, dates or claims. Use only facts from the brand context and the brief.",
  "Never use a forbidden word or claim listed for the brand.",
  "Write in the brand's voice. Use sourceFile only with names from the source list, and null otherwise.",
].join("\n");

export function buildScriptMessages(input: {
  brandSummary: string;
  forbidden: string;
  brief: ReelBrief;
  title: string;
  inventory: string;
  /** Problems from a previous attempt, so the model can fix them. */
  problems?: string[];
}): { role: "system" | "user"; content: string }[] {
  const feedback = input.problems?.length
    ? `\n\nYour previous script had these problems. Fix all of them and return the full script again:\n${input.problems.map((p) => `- ${p}`).join("\n")}`
    : "";
  return [
    { role: "system", content: SCRIPT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Brand context:\n${input.brandSummary}`,
        `Forbidden for this brand: ${input.forbidden}`,
        `Reel title: ${input.title}`,
        `Goal: ${input.brief.goal}`,
        `Length: ${input.brief.durationSec} seconds, aspect ratio ${input.brief.aspectRatio}`,
        `Source files available:\n${input.inventory}`,
        `Return the JSON script now.${feedback}`,
      ].join("\n\n"),
    },
  ];
}

export type ScriptCheck =
  | { ok: true; script: ReelScript }
  | { ok: false; problems: string[] };

/** Parses the model's JSON, checks the schema, then checks the timing. Any failure comes back as readable problems. */
export function checkScriptOutput(raw: string, durationSec: number): ScriptCheck {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, problems: ["The script was not valid JSON."] };
  }
  const parsed = reelScriptSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "script"}: ${i.message}`),
    };
  }
  const problems = validateReelScript(parsed.data, durationSec);
  return problems.length ? { ok: false, problems } : { ok: true, script: parsed.data };
}

/**
 * Brand-rule problems in the text a viewer reads or hears. Reuses the
 * compliance text rules, so the same forbidden-word and claim checks apply.
 */
export function scriptComplianceNotes(profile: BrandProfile | null, script: ReelScript | null): string[] {
  if (!profile || !script) return [];
  const text = [
    script.title,
    script.hook,
    script.cta,
    ...script.shots.flatMap((s) => [s.voiceover, s.onScreenText, s.description]),
  ]
    .filter((t): t is string => Boolean(t))
    .join("\n");
  return checkTextRules(profile, text)
    .filter((f) => f.severity === "fail")
    .map((f) => f.detail);
}
