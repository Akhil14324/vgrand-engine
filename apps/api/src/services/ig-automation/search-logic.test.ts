import { describe, expect, it } from "vitest";
import { igSearchSchema, type IgSearchQuery } from "@catgpt/types";
import { SEARCH_RESULT_LIMIT, searchEvents, wordsOf, type SearchEvent } from "./search-logic.js";

let n = 0;
const ev = (user: string, text: string, over: Partial<SearchEvent> = {}): SearchEvent => ({
  id: `e${++n}`, kind: "comment", fromId: `id-${user}`, fromUsername: user, text, occurredAt: new Date("2026-11-20T10:00:00Z"), status: "done", ...over,
});
const run = (events: SearchEvent[], query: Partial<IgSearchQuery> = {}, keywords = ["price", "site visit"]) =>
  searchEvents(events, keywords, { q: "", by: "word", scope: "all", ...query });

const events = [
  ev("ravi_k", "Price?"),
  ev("ravi_k", "location please"),
  ev("sita", "what is the location @friend 9876543210"),
  ev("kumar", "want a site visit"),
  ev("anil", "priceless view"),
  ev("meena", "ధర ఎంత"),
];

describe("words", () => {
  it("drops mentions, links, phone numbers and filler, and keeps Telugu intact", () => {
    expect(wordsOf("Hi, what is the PRICE @bob https://x.test 98765 43210 ధర")).toEqual(["price", "ధర"]);
  });
});

describe("search", () => {
  it("finds everything one username typed, with or without @", () => {
    const r = run(events, { by: "user", q: "@Ravi" });
    expect(r.results.map((x) => x.text)).toEqual(["Price?", "location please"]);
    expect([r.total, r.people]).toEqual([2, 1]);
  });
  it("finds who typed a word", () => {
    const r = run(events, { q: "location" });
    expect(r.results.map((x) => x.fromUsername)).toEqual(["ravi_k", "sita"]);
    expect(r.people).toBe(2);
    expect(run(events, { q: "ధర" }).results.map((x) => x.fromUsername)).toEqual(["meena"]);
  });
  it("separates our keywords from everything else, matching whole words like the rules do", () => {
    expect(run(events, { scope: "ours" }).results.map((x) => x.fromUsername)).toEqual(["ravi_k", "kumar"]);
    const other = run(events, { scope: "other" });
    expect(other.results.map((x) => x.fromUsername)).toEqual(["ravi_k", "sita", "anil", "meena"]);
    expect(other.results.every((x) => x.matched.length === 0)).toBe(true);
  });
  it("counts our keywords, and ranks other words by how many people used them", () => {
    const r = run(events);
    expect(r.keywords).toEqual([{ word: "price", comments: 1, people: 1 }, { word: "site visit", comments: 1, people: 1 }]);
    expect(r.words[0]).toEqual({ word: "location", comments: 2, people: 2 });
    expect(r.words.map((w) => w.word)).not.toContain("price");
    expect(r.words.map((w) => w.word)).toContain("priceless");
  });
  it("treats every word as 'other' when rules have no keywords", () => {
    expect(run(events, { scope: "other" }, []).total).toBe(events.length);
  });
  it("limits the rows but not the counts", () => {
    const many = Array.from({ length: 250 }, (_, i) => ev(`u${i}`, "location"));
    const r = run(many, { q: "location" });
    expect([r.results.length, r.total, r.people]).toEqual([SEARCH_RESULT_LIMIT, 250, 250]);
  });
  it("has safe defaults for the query", () => {
    expect(igSearchSchema.parse({})).toEqual({ q: "", by: "word", scope: "all" });
    expect(igSearchSchema.safeParse({ by: "email" }).success).toBe(false);
  });
});
