import OpenAI from "openai";
import { prisma } from "@prompthub/db";
import type { GenerationKind } from "@prompthub/types";
import { env } from "../env.js";

/**
 * Text side of the studio: intent classification ("does this prompt ask for
 * an image?") and plain-text answers for everything that isn't. Both run on
 * CHAT_MODEL — a cheap chat model, not the image engines.
 */

export interface HistoryTurn {
  prompt: string;
  kind: string;
  textResponse: string | null;
}

/** Recent turns of a conversation, oldest first, for model context. */
export async function loadChatHistory(
  conversationId: string,
  excludeId?: string,
  take = 12,
): Promise<HistoryTurn[]> {
  const rows = await prisma.generation.findMany({
    where: {
      conversationId,
      status: "completed",
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { prompt: true, kind: true, textResponse: true },
  });
  return rows.reverse();
}

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

function toMessages(history: HistoryTurn[]) {
  return history.flatMap((t) => [
    { role: "user" as const, content: t.prompt },
    {
      role: "assistant" as const,
      content:
        t.kind === "text" && t.textResponse
          ? t.textResponse
          : "[generated an image]",
    },
  ]);
}

const CLASSIFY_SYSTEM = `You classify messages sent to PromptHub, an AI image-generation studio. Reply with exactly one word: IMAGE or CHAT.

IMAGE: the user wants an image created or edited — poster, logo, scene, artwork, UI mock, photo — including follow-ups like "make it darker" or "same but at night" when the conversation already produced images.

CHAT: questions, explanations, coding help, conversation, or anything that does not ask for an image.`;

/**
 * IMAGE or CHAT for an ambiguous prompt. Explicit opt-ins (armed /theme,
 * reference image, regenerate) are resolved by the caller before this runs.
 * On classifier failure we default to image — the studio's primary job.
 */
export async function classifyIntent(
  prompt: string,
  history: HistoryTurn[],
): Promise<GenerationKind> {
  try {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: 0,
      max_tokens: 4,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        ...toMessages(history),
        { role: "user", content: prompt },
      ],
    });
    const verdict = res.choices[0]?.message.content?.trim().toUpperCase();
    return verdict?.startsWith("IMAGE") ? "image" : "text";
  } catch {
    return "image";
  }
}

const CHAT_SYSTEM = `You are PromptHub, an AI image-generation studio assistant. Answer questions helpfully and concisely in plain text — short paragraphs, lists only when they genuinely help.

User messages often have typos, missing words, or mixed English/Telugu. Never comment on spelling or ask the user to rephrase — silently correct mistakes and answer the most likely meaning. If the interpretation isn't obvious, state it briefly first ("Sounds like you mean…") and still answer. Ask a clarifying question only when two very different meanings are equally likely.

If the user seems to want an image, invite them to describe it and you'll generate it. Never claim to have generated an image.`;

/** Produce the assistant's text reply for a non-image turn. */
export async function answerChat(
  prompt: string,
  history: HistoryTurn[],
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    messages: [
      { role: "system", content: CHAT_SYSTEM },
      ...toMessages(history),
      { role: "user", content: prompt },
    ],
  });
  const text = res.choices[0]?.message.content?.trim();
  if (!text) throw new Error("chat model returned an empty response");
  return text;
}
