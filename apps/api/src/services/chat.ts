import OpenAI from "openai";
import { prisma } from "@catgpt/db";
import type { GenerationKind } from "@catgpt/types";
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

const CLASSIFY_SYSTEM = `You classify messages sent to CatGPT, an AI image-generation studio. Reply with exactly one word: IMAGE or CHAT.

IMAGE: the user wants an image created or edited — poster, logo, scene, artwork, UI mock, photo — including follow-ups like "make it darker" or "same but at night" when the conversation already produced images.

CHAT: questions, explanations, coding help, document requests, conversation, or anything that does not ask for an image.`;

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

const CHAT_SYSTEM = `You are CatGPT, an AI studio assistant that also generates images on request. Answer in well-formatted Markdown: use headers sparingly, fenced code blocks with the language tag (\`\`\`ts, \`\`\`py…), and lists only when they genuinely help.

You can:
- Answer questions and explain concepts clearly and concisely.
- Help with coding: write, debug, review, and explain code; run coding assessments — generate interview-style questions or quizzes on request, and grade/evaluate code the user pastes with specific, constructive feedback.
- Answer questions about PDFs the user attached — retrieved passages are provided as "Document context"; ground your answers in them and say when the document doesn't cover something. Quote filenames when relevant.
- If the user seems to want an image, tell them to start the request with "create an image" (a /theme like /restaurant or /infra adds brand styling). Never claim to have generated an image or a file you didn't actually produce.

User messages often have typos, missing words, or mixed English/Telugu. Never comment on spelling or ask the user to rephrase — silently correct mistakes and answer the most likely meaning. If the interpretation isn't obvious, state your best guess briefly and answer it fully anyway — never end your reply with a clarifying question.`;

function contextMessage(context: string[]) {
  if (context.length === 0) return [];
  return [
    {
      role: "system" as const,
      content: `Document context retrieved from the user's attached PDFs. Use it to ground your answer; if it doesn't address the question, say so.\n\n${context.join("\n\n---\n\n")}`,
    },
  ];
}

/** Non-streaming reply (kept for callers that need the full string at once). */
export async function answerChat(
  prompt: string,
  history: HistoryTurn[],
  context: string[] = [],
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    messages: [
      { role: "system", content: CHAT_SYSTEM },
      ...contextMessage(context),
      ...toMessages(history),
      { role: "user", content: prompt },
    ],
  });
  const text = res.choices[0]?.message.content?.trim();
  if (!text) throw new Error("chat model returned an empty response");
  return text;
}

/**
 * Streaming reply — invokes onDelta for each token chunk as it arrives so the
 * SSE layer can push live updates. Returns the complete assembled text.
 */
export async function streamChat(
  prompt: string,
  history: HistoryTurn[],
  context: string[] = [],
  onDelta: (delta: string) => void,
): Promise<string> {
  const stream = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    stream: true,
    messages: [
      { role: "system", content: CHAT_SYSTEM },
      ...contextMessage(context),
      ...toMessages(history),
      { role: "user", content: prompt },
    ],
  });
  let acc = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      acc += delta;
      onDelta(delta);
    }
  }
  if (!acc.trim()) throw new Error("chat model returned an empty response");
  return acc;
}
