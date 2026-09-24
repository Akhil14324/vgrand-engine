import OpenAI from "openai";
import { prisma } from "@catgpt/db";
import type { HistoryTurn } from "./chat.js";
import { env } from "../env.js";

/**
 * ChatGPT-style long-term memory. After each text turn a cheap extraction
 * call decides whether the user revealed anything durable (name, role, stack,
 * preferences, ongoing projects). Learned rows get type "learned" so they
 * never collide with generation snapshots (type "fact"). The latest handful
 * is injected into every chat turn's context.
 */

const LEARNED_TYPE = "learned";
const MAX_INJECTED = 15;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
  });
  return client;
}

/** Recent learned facts, newest last — injected as system context per turn. */
export async function loadLearnedMemories(userId: string): Promise<string[]> {
  const rows = await prisma.memory.findMany({
    where: { userId, type: LEARNED_TYPE },
    orderBy: { createdAt: "desc" },
    take: MAX_INJECTED,
    select: { content: true },
  });
  return rows.map((r) => r.content).reverse();
}

const EXTRACT_SYSTEM = `You extract durable facts about the USER worth remembering across chats — name, role, tech stack, preferences, constraints, ongoing projects. Only facts about the user, never about the topic discussed. Reply with a JSON array of short strings, or [] if the exchange contains nothing worth remembering. No prose, just the JSON array.`;

/** Post-turn extraction — runs fire-and-forget, never blocks the reply. */
export async function rememberTurn(
  userId: string,
  conversationId: string | null,
  turns: Pick<HistoryTurn, "prompt" | "textResponse">[],
): Promise<void> {
  try {
    const transcript = turns
      .map(
        (t) =>
          `User: ${t.prompt}\nAssistant: ${(t.textResponse ?? "").slice(0, 600)}`,
      )
      .join("\n\n");
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: transcript },
      ],
    });
    const raw = res.choices[0]?.message.content?.trim() ?? "";
    const facts = parseFacts(raw).slice(0, 5);
    if (facts.length === 0) return;

    // Skip exact duplicates already remembered for this user.
    const existing = new Set(await loadLearnedMemories(userId));
    const fresh = facts.filter((f) => !existing.has(f));
    if (fresh.length === 0) return;

    await prisma.memory.createMany({
      data: fresh.map((content) => ({
        userId,
        type: LEARNED_TYPE,
        content,
        metadata: { learned: true, conversationId },
      })),
    });
  } catch (err) {
    // Memory is opportunistic — a failed extraction must never surface.
    console.warn("[memory] extraction failed:", (err as Error).message);
  }
}

/** Tolerant JSON-array parse — models sometimes wrap output in a fence. */
function parseFacts(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as unknown;
    return Array.isArray(arr)
      ? arr.filter((s): s is string => typeof s === "string" && s.length > 2)
      : [];
  } catch {
    return [];
  }
}
