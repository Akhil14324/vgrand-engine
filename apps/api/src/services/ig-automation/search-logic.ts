/**
 * Searching what people typed: by username, by word, and "which other words are
 * people using besides our keywords". Pure; the service feeds it stored events.
 */
import type { IgSearchDto, IgSearchQuery, IgWordCount } from "@catgpt/types";
import { containsKeyword } from "./logic.js";

export const SEARCH_RESULT_LIMIT = 200;
export const SEARCH_WORD_LIMIT = 40;

/** Filler words that say nothing about what someone wants. */
const STOP_WORDS = new Set(
  "a an and any are as at be but by can do for from hai have hi how i in is it its me my of on or our please pls plz sir so that the this to u ur was we what with you your".split(" "),
);

/** Case- and form-insensitive, but vowel signs (Telugu, Hindi) are kept. */
const fold = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** The words of one comment. Mentions, links, bare numbers (often phone numbers) and filler are left out. */
export function wordsOf(text: string): string[] {
  const cleaned = fold(text).replace(/(https?:\/\/\S+|@[\p{L}\p{N}_.]+)/gu, " ");
  const words = cleaned.split(/[^\p{L}\p{M}\p{N}_]+/u).filter((w) => [...w].length > 1 && !/^[\p{N}_]+$/u.test(w) && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

export interface SearchEvent {
  id: string;
  kind: string;
  fromId: string | null;
  fromUsername: string | null;
  text: string | null;
  occurredAt: Date;
  status: string;
}

class Tally {
  comments = 0;
  people = new Set<string>();
  add(person: string) {
    this.comments++;
    this.people.add(person);
  }
}

const toCount = (word: string, t: Tally): IgWordCount => ({ word, comments: t.comments, people: t.people.size });

/**
 * `events` newest first. `keywords` are the ones set on the account's rules; a
 * comment "uses our keyword" by the same whole-word test the rules use.
 */
export function searchEvents(events: SearchEvent[], keywords: string[], query: IgSearchQuery): Omit<IgSearchDto, "truncated"> {
  const configured = [...new Map(keywords.map((k) => [fold(k), k.trim()])).values()].filter(Boolean);
  const ourWords = new Set(configured.flatMap(wordsOf));
  const ours = new Map(configured.map((k) => [k, new Tally()]));
  const others = new Map<string, Tally>();

  const q = fold(query.by === "user" ? query.q.trim().replace(/^@/, "") : query.q);
  const results: IgSearchDto["results"] = [];
  const people = new Set<string>();
  let total = 0;

  for (const e of events) {
    const text = e.text ?? "";
    const person = e.fromId ?? e.fromUsername ?? e.id;
    const matched = configured.filter((k) => containsKeyword(text, k));
    for (const k of matched) ours.get(k)!.add(person);
    for (const word of wordsOf(text)) {
      if (ourWords.has(word)) continue;
      let t = others.get(word);
      if (!t) others.set(word, (t = new Tally()));
      t.add(person);
    }

    if (query.scope === "ours" && !matched.length) continue;
    if (query.scope === "other" && matched.length) continue;
    if (q && !fold(query.by === "user" ? (e.fromUsername ?? "") : text).includes(q)) continue;
    total++;
    people.add(person);
    if (results.length < SEARCH_RESULT_LIMIT) {
      results.push({ id: e.id, kind: e.kind, fromId: e.fromId, fromUsername: e.fromUsername, text, occurredAt: e.occurredAt.toISOString(), status: e.status, matched });
    }
  }

  return {
    results,
    total,
    people: people.size,
    scanned: events.length,
    keywords: [...ours].map(([word, t]) => toCount(word, t)),
    words: [...others]
      .map(([word, t]) => toCount(word, t))
      .sort((a, b) => b.people - a.people || b.comments - a.comments || a.word.localeCompare(b.word))
      .slice(0, SEARCH_WORD_LIMIT),
  };
}
