import OpenAI from "openai";
import type { ResponseIncludable } from "openai/resources/responses/responses";
import { prisma } from "@catgpt/db";
import type { GenerationKind, WebSource } from "@catgpt/types";
import { evaluate, jevConfigured } from "./jev.js";
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
  /** Images the user attached for the model to look at (vision turns). */
  images?: string[];
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
    take: take + 8,
    select: { prompt: true, kind: true, textResponse: true, metadata: true },
  });
  // Auto-written campaign creative briefs are long machine prompts, not things
  // the user said - keeping them would bloat and confuse the model's context.
  return rows
    .filter(
      (r) =>
        !(r.metadata as Record<string, unknown> | null)?.campaignCreative,
    )
    .slice(0, take)
    .reverse()
    .map(({ prompt, kind, textResponse, metadata }) => {
      const v = (metadata as Record<string, unknown> | null)?.visionImageUrls;
      return {
        prompt,
        kind,
        textResponse,
        ...(Array.isArray(v) ? { images: v as string[] } : {}),
      };
    });
}

let client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
    timeout: 120_000,
    maxRetries: 2,
  });
  return client;
}

const assistantText = (t: HistoryTurn) =>
  t.kind === "text" && t.textResponse ? t.textResponse : "[generated an image]";

/** Plain-text history - safe for both the chat-completions and Responses APIs. */
export function toMessages(history: HistoryTurn[]) {
  return history.flatMap((t) => [
    { role: "user" as const, content: t.prompt },
    { role: "assistant" as const, content: assistantText(t) },
  ]);
}

/**
 * History for chat-completions with vision. Only the most recent image-bearing
 * turn keeps its pictures - enough for follow-up questions ("and the button on
 * the left?") without re-sending every image on every turn.
 */
export function toVisionMessages(
  history: HistoryTurn[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let last = -1;
  history.forEach((t, i) => {
    if (t.images?.length) last = i;
  });
  return history.flatMap((t, i): OpenAI.Chat.ChatCompletionMessageParam[] => [
    {
      role: "user",
      content: i === last ? userContent(t.prompt, t.images ?? []) : t.prompt,
    },
    { role: "assistant", content: assistantText(t) },
  ]);
}

/** A user message with pictures, in the chat-completions vision format. */
export function userContent(
  text: string,
  images: string[],
): string | OpenAI.Chat.ChatCompletionContentPart[] {
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
}

const CLASSIFY_SYSTEM = `You classify messages sent to CatGPT, an AI image-generation studio. Reply with exactly one word: IMAGE or CHAT.

IMAGE: the user wants an image created or edited — poster, logo, scene, artwork, UI mock, photo — including follow-ups like "make it darker" or "same but at night" when the conversation already produced images.

CHAT: questions, explanations, coding help, document requests, conversation, or anything that does not ask for an image.`;

/**
 * IMAGE or CHAT for an ambiguous prompt. Explicit opt-ins (armed /theme,
 * reference image, regenerate) are resolved by the caller before this runs.
 * On classifier failure we default to image — the studio's primary job.
 *
 * Jev answers this as a typed choice question — a fast eval call instead of
 * a chat completion. Without TYPESAFE_API_KEY (or if Jev errors) the OpenAI
 * classifier below runs unchanged.
 */
export async function classifyIntent(
  prompt: string,
  history: HistoryTurn[],
  opts: { hasImage?: boolean } = {},
): Promise<GenerationKind> {
  if (jevConfigured()) {
    try {
      // State is an array of text turns, most recent last — capped so a long
      // chat never nears Jev's 32k state budget.
      const state = [
        ...history.slice(-8).flatMap((t) => [
          `User: ${t.prompt.slice(0, 500)}`,
          `Assistant: ${assistantText(t).slice(0, 500)}`,
        ]),
        `User: ${prompt.slice(0, 2000)}`,
      ];
      const answers = await evaluate(state, {
        intent: {
          type: "choice",
          instructions: opts.hasImage
            ? "Classify the user's latest message for CatGPT, an AI image-generation studio. The user attached an image: questions ABOUT the image (what is it, what is wrong with it, describe/read/analyze/compare it, give feedback) are chat; requests to CHANGE or build on it (edit, restyle, remove or add something, make a poster/variation from it) are image."
            : "Classify the user's latest message for CatGPT, an AI image-generation studio.",
          criteria: {
            image:
              "The user wants an image created or edited — poster, logo, scene, artwork, UI mock, photo — including follow-ups like 'make it darker' or 'same but at night' when the conversation already produced images.",
            chat: "Questions, explanations, coding help, document requests, conversation, or anything that does not ask for an image.",
          },
        },
      });
      const verdict = answers.intent?.choice;
      if (verdict === "image" || verdict === "chat") {
        return verdict === "image" ? "image" : "text";
      }
    } catch (err) {
      console.warn(
        "[jev] intent classification failed, using chat model:",
        (err as Error).message,
      );
    }
  }
  try {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: 0,
      max_tokens: 4,
      messages: [
        {
          role: "system",
          content: opts.hasImage
            ? `${CLASSIFY_SYSTEM}\n\nThe user attached an image to this message. Questions ABOUT the image (what is it, what is wrong with it, describe/read/analyze/compare it, give feedback) are CHAT. Requests to CHANGE or build on it (edit, restyle, remove or add something, make a poster/variation from it) are IMAGE.`
            : CLASSIFY_SYSTEM,
        },
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
- Look at images the user attaches: describe them, read text in them, give design/UX/product feedback, compare options, or answer questions about them. Base your answer only on what is actually visible.
- If the user seems to want an image, tell them to start the request with "create an image" (a /theme like /restaurant or /infra adds brand styling). Never claim to have generated an image or a file you didn't actually produce.

User messages often have typos, missing words, or mixed English/Telugu. Never comment on spelling or ask the user to rephrase — silently correct mistakes and answer the most likely meaning. If the interpretation isn't obvious, state your best guess briefly and answer it fully anyway — never end your reply with a clarifying question.`;

const WORKSPACE_SYSTEM = `You are CatGPT working inside a Workspace — a curated set of documents the user assembled for analysis. The retrieved "Document context" below is your PRIMARY source: ground every answer in it first, quote filenames when relevant, and say plainly when the workspace doesn't cover something.

Be direct and practical: no hedging, no disclaimers, no sugar-coating. When the user asks for a strategy, plan, or next move, give ONE concrete recommendation with reasoning — not a menu of open-ended options. Answer in well-formatted Markdown.`;

const VOICE_SYSTEM = `You are CatGPT in a live VOICE conversation - your reply is read aloud, so write exactly how a friendly, sharp person would speak.
- Keep it short: one to three sentences unless the user clearly asks for more detail.
- Plain spoken language only: no Markdown, bullet points, headings, code, emojis, URLs or symbols. Say numbers and units naturally.
- Get straight to the point; no preamble like "Sure!" every time, and never read out formatting.
- The user's words come from speech recognition and may contain mistakes or mixed English and Telugu; silently infer the most likely meaning and answer it. Never ask them to repeat unless the audio is truly unintelligible.
- If a question really needs a long answer (steps, code, a document), give a short spoken summary and say the full answer is in the chat.`;

export type ChatMode = "chat" | "workspace" | "voice";

const systemFor = (mode: ChatMode) =>
  mode === "workspace"
    ? WORKSPACE_SYSTEM
    : mode === "voice"
      ? VOICE_SYSTEM
      : CHAT_SYSTEM;

export function contextMessage(context: string[]) {
  if (context.length === 0) return [];
  return [
    {
      role: "system" as const,
      content: `Document context retrieved from the user's attached PDFs. Use it to ground your answer; if it doesn't address the question, say so.\n\n${context.join("\n\n---\n\n")}`,
    },
  ];
}

export function memoryMessage(memories: string[]) {
  if (memories.length === 0) return [];
  return [
    {
      role: "system" as const,
      content: `Things you remember about this user from earlier chats. Use them naturally when relevant — never recite the list or mention "memory".\n${memories.map((m) => `- ${m}`).join("\n")}`,
    },
  ];
}

/**
 * Brand mode: the compact brand digest (never the raw files - those are
 * retrieved as passages on demand). Off = a normal, common answer.
 */
export function brandMessage(brand: string | null) {
  if (!brand) return [];
  return [
    {
      role: "system" as const,
      content: `The user has switched on BRAND MODE. Answer as the marketing and sales assistant for this brand, using its facts, audience, voice and goals below. Ground advice in these facts, write copy in the brand's tone, and say plainly when something is not covered instead of inventing brand details.\n\n${brand}`,
    },
  ];
}

/** Non-streaming reply (kept for callers that need the full string at once). */
export async function answerChat(
  prompt: string,
  history: HistoryTurn[],
  context: string[] = [],
  memories: string[] = [],
  mode: ChatMode = "chat",
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    messages: [
      { role: "system", content: systemFor(mode) },
      ...memoryMessage(memories),
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
  memories: string[] = [],
  mode: ChatMode = "chat",
  onDelta: (delta: string) => void = () => {},
  brand: string | null = null,
  images: string[] = [],
): Promise<string> {
  const stream = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    stream: true,
    messages: [
      { role: "system", content: systemFor(mode) },
      ...brandMessage(brand),
      ...memoryMessage(memories),
      ...contextMessage(context),
      ...toVisionMessages(history),
      { role: "user", content: userContent(prompt, images) },
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

/* --------------------------- document summaries --------------------------- */

const SUMMARY_INTENT =
  /\b(summari[sz]e|summari[sz]ation|summary|tl;?\s?dr|recap|key\s+(?:points|takeaways)|gist|main\s+points|brief\s+(?:me|overview)|overview\s+of)\b/i;

/**
 * Does this turn ask for a whole-document summary (as opposed to a pointed
 * question about it)? The regex catches the obvious phrasings; otherwise a
 * confident Jev verdict decides. Callers also require documents in scope.
 */
export function wantsDocumentSummary(
  prompt: string,
  jevSays: boolean | null = null,
): boolean {
  if (SUMMARY_INTENT.test(prompt)) return true;
  return jevSays === true;
}

/* ----------------------------- document edits ----------------------------- */

const EDIT_VERB =
  /\b(edit|rewrite|re-?write|rephrase|reword|paraphrase|proofread|revise|redraft|reformat|shorten|condense|translate|polish|tweak)\b/i;
const EDIT_OBJECT =
  /\b(document|doc|docx|pdf|file|resume|cv|letter|report|contract|paper|essay|article|proposal|attachment|attached|uploaded)\b/i;

/**
 * Does this turn ask to rewrite the attached/previous document itself and
 * hand back a new file? An edit verb is enough when a file was attached to
 * THIS message; on later turns it also needs a document noun (or a confident
 * Jev verdict) so "rewrite this function" in a doc-heavy chat stays chat.
 */
export function wantsDocumentEdit(
  prompt: string,
  opts: { attachedNow: boolean; jevSays: boolean | null },
): boolean {
  if (!EDIT_VERB.test(prompt)) return opts.jevSays === true;
  return opts.attachedNow || EDIT_OBJECT.test(prompt) || opts.jevSays === true;
}

/* ---------------------------- code execution ----------------------------- */

const RUN_PREFIX = /^\/run\b/i;
const RUN_INTENT = /\b(run|execute|eval(?:uate)?|test)\b/i;
const CODE_FENCE = /```[\s\S]+?```/;

/**
 * Should this turn actually execute code? Explicit `/run …` always counts;
 * a Jev verdict wins when present; otherwise a fenced code block plus a run
 * verb ("run this", "execute it") decides.
 */
export function wantsCodeExecution(
  prompt: string,
  jevSays: boolean | null = null,
): boolean {
  if (RUN_PREFIX.test(prompt)) return true;
  if (jevSays != null) return jevSays;
  return CODE_FENCE.test(prompt) && RUN_INTENT.test(prompt);
}

/** Strip the /run prefix so the model sees the real instruction. */
export function stripRunPrefix(prompt: string): string {
  return prompt.replace(RUN_PREFIX, "").trim();
}

interface CodeCall {
  code: string;
  logs: string[];
}

/**
 * Executes code in OpenAI's hosted Python sandbox (code_interpreter on the
 * Responses API — same OPENAI_API_KEY). Non-streaming: runs take seconds
 * anyway, and the reply is assembled once — code + output formatted as
 * Markdown so the UI renders it like ChatGPT's analysis blocks.
 */
export async function runWithCodeInterpreter(
  prompt: string,
  history: HistoryTurn[],
): Promise<string> {
  const res = await getClient().responses.create({
    model: env.CODE_MODEL,
    tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    input: [
      {
        role: "developer",
        content:
          "You are CatGPT's code runner. Run the user's code (or the code needed to answer their request) in the Python sandbox. Report results concisely — real stdout/stderr, never invented.",
      },
      ...toMessages(history.slice(-6)),
      { role: "user", content: prompt },
    ],
  });

  const calls: CodeCall[] = [];
  for (const item of res.output ?? []) {
    if (item.type === "code_interpreter_call") {
      const logs = (item.outputs ?? [])
        .map((r) => (r.type === "logs" ? r.logs : ""))
        .filter(Boolean);
      calls.push({ code: item.code ?? "", logs });
    }
  }

  const parts: string[] = [];
  const summary = res.output_text?.trim();
  if (summary) parts.push(summary);
  for (const call of calls) {
    if (call.code) parts.push(`**Code**\n\`\`\`python\n${call.code}\n\`\`\``);
    if (call.logs.length)
      parts.push(`**Output**\n\`\`\`\n${call.logs.join("\n").trim()}\n\`\`\``);
  }
  if (!parts.length) throw new Error("code interpreter returned nothing");
  return parts.join("\n\n");
}

/* ------------------------------- web search ------------------------------- */

const SEARCH_PREFIX = /^\/search\b/i;
const FRESHNESS_HINT =
  /\b(today|tonight|tomorrow|yesterday|latest|current(?:ly)?|right now|news|breaking|recent(?:ly)?|this (?:week|month|year)|upcoming|trending|live|20(?:2[5-9]|3\d))\b|\b(price of|stock|share price|weather|forecast|score|exchange rate|release date|who won|who is the (?:current )?(?:ceo|president|prime minister)|look up|search (?:for|the web)|google)\b/i;

/**
 * Should this turn hit the live web? Explicit opt-ins (the composer's Search
 * toggle, a `/search` prefix) always count. Otherwise only time-sensitive
 * phrasing does — a regex, so ordinary chat pays zero extra latency and the
 * search tool (a few extra seconds) is used only when it earns its keep.
 * Turns grounded in the user's own documents never auto-search. A Jev
 * verdict (jevSays) replaces the regex when one was evaluated — it reads
 * intent instead of matching keywords.
 */
export function wantsWebSearch(
  prompt: string,
  opts: {
    forced?: boolean;
    hasDocuments?: boolean;
    jevSays?: boolean | null;
  } = {},
): boolean {
  if (opts.forced || SEARCH_PREFIX.test(prompt)) return true;
  if (opts.hasDocuments) return false;
  if (opts.jevSays != null) return opts.jevSays;
  return FRESHNESS_HINT.test(prompt);
}

export function stripSearchPrefix(prompt: string): string {
  return prompt.replace(SEARCH_PREFIX, "").trim();
}

const SEARCH_SYSTEM = `${CHAT_SYSTEM}

You have a live web search tool. Use it for anything time-sensitive or that you cannot answer confidently from memory (news, prices, scores, recent releases, current office-holders). Search once, precisely; do not search for things you already know. Ground the answer in what you found, state dates when they matter, and mention the source site by name in the sentence. If results conflict or are thin, say so.`;

export interface SearchReply {
  text: string;
  sources: WebSource[];
}

/**
 * Streaming answer with the Responses API's built-in web_search tool.
 * Tokens flow through onDelta exactly like streamChat; onSearching fires when
 * the model decides to search (drives the "Searching the web..." state);
 * citations are collected and de-duplicated by URL. `search_context_size:
 * "low"` keeps searches fast and cheap.
 */
export async function streamChatWithSearch(
  prompt: string,
  history: HistoryTurn[],
  context: string[] = [],
  memories: string[] = [],
  onDelta: (delta: string) => void = () => {},
  onSearching: () => void = () => {},
  brand: string | null = null,
): Promise<SearchReply> {
  const stream = await getClient().responses.create({
    model: env.CHAT_MODEL,
    stream: true,
    // Without this the API returns no source list at all for a search. The
    // installed SDK typings predate the option, hence the cast.
    include: ["web_search_call.action.sources"] as unknown as ResponseIncludable[],
    tools: [{ type: "web_search", search_context_size: "low" }],
    input: [
      { role: "developer", content: SEARCH_SYSTEM },
      ...brandMessage(brand),
      ...memoryMessage(memories),
      ...contextMessage(context),
      ...toMessages(history),
      { role: "user", content: prompt },
    ],
  });

  let text = "";
  const sources = new Map<string, WebSource>();
  for await (const evt of stream) {
    if (evt.type === "response.web_search_call.searching") {
      onSearching();
    } else if (evt.type === "response.output_text.delta") {
      text += evt.delta;
      onDelta(evt.delta);
    } else if (evt.type === "response.output_text.annotation.added") {
      const a = evt.annotation as {
        type?: string;
        url?: string;
        title?: string;
      };
      if (a.type === "url_citation" && a.url && !sources.has(a.url)) {
        sources.set(a.url, { url: a.url, title: a.title?.trim() || a.url });
      }
    } else if (evt.type === "response.completed") {
      // Citations are not always streamed as separate events - read them off
      // the finished message too.
      for (const item of evt.response.output ?? []) {
        if (item.type === "web_search_call") {
          const action = (
            item as unknown as {
              action?: { type?: string; sources?: { url: string }[] };
            }
          ).action;
          for (const s of action?.type === "search" ? (action.sources ?? []) : []) {
            if (!sources.has(s.url)) {
              let host = s.url;
              try {
                host = new URL(s.url).hostname.replace(/^www\./, "");
              } catch {
                // keep the raw url as the title
              }
              sources.set(s.url, { url: s.url, title: host });
            }
          }
          continue;
        }
        if (item.type !== "message") continue;
        for (const part of item.content) {
          if (part.type !== "output_text") continue;
          for (const a of part.annotations ?? []) {
            if (a.type === "url_citation" && !sources.has(a.url)) {
              sources.set(a.url, { url: a.url, title: a.title?.trim() || a.url });
            }
          }
        }
      }
    } else if (evt.type === "response.failed" || evt.type === "error") {
      throw new Error("web search response failed");
    }
  }
  if (!text.trim()) throw new Error("web search returned an empty response");
  return { text, sources: [...sources.values()] };
}
