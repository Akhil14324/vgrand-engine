import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import { getClient } from "./chat.js";
import { retrieveContext } from "./documents.js";

/** "@ai" or "@catgpt" anywhere in a message addresses the assistant. */
const AI_MENTION = /(^|\s)@(ai|catgpt)\b/i;
export const addressesAi = (body: string) => AI_MENTION.test(body);
export const stripMention = (body: string) =>
  body.replace(/(^|\s)@(ai|catgpt)\b[:,]?/gi, " ").replace(/\s+/g, " ").trim();

const TEAM_SYSTEM = `You are CatGPT, an AI teammate inside a shared team workspace chat. Several people talk to each other here and call on you with @ai.
- Answer the person who just addressed you, by name when it feels natural, but keep the whole team's conversation in mind.
- Be concise and practical - this is a chat, not an essay. Use Markdown sparingly.
- The "Workspace documents" passages (if any) are the team's shared files: ground your answer in them and name the file. Say plainly when they do not cover something.
- Never invent facts about the team, its documents or its numbers. If you lack information, say what is missing.
- Messages may contain typos or mixed English/Telugu; silently infer the meaning.`;

export const displayName = (u: { name: string | null; email: string } | null) =>
  u ? u.name?.trim() || u.email.split("@")[0]! : "CatGPT";

/**
 * Fills in a pending AI reply in the team chat: last ~20 messages for
 * context, plus retrieval over the workspace's shared documents. Failures
 * become a visible "failed" reply rather than a spinner that never ends.
 */
export async function answerTeamMessage(params: {
  aiMessageId: string;
  workspaceId: string;
  askerId: string;
  question: string;
}) {
  const { aiMessageId, workspaceId, askerId, question } = params;
  try {
    const [recent, asker] = await Promise.all([
      prisma.teamMessage.findMany({
        where: { workspaceId, status: "done", NOT: { id: aiMessageId } },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { author: { select: { name: true, email: true } } },
      }),
      prisma.user.findUnique({
        where: { id: askerId },
        select: { name: true, email: true },
      }),
    ]);
    const transcript = recent
      .reverse()
      .map((m) => `${m.role === "ai" ? "CatGPT" : displayName(m.author)}: ${m.body}`)
      .join("\n");

    const context = await retrieveContext(question, {
      conversationId: null,
      workspaceId,
    }).catch(() => []);

    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      messages: [
        { role: "system", content: TEAM_SYSTEM },
        ...(context.length
          ? [
              {
                role: "system" as const,
                content: `Workspace documents (shared by the team):\n\n${context.join("\n\n---\n\n")}`,
              },
            ]
          : []),
        {
          role: "user",
          content: `Team chat so far:\n${transcript || "(no earlier messages)"}\n\nNow ${displayName(asker)} asks you: ${question}`,
        },
      ],
    });
    const text = res.choices[0]?.message.content?.trim();
    if (!text) throw new Error("empty answer");
    await prisma.teamMessage.update({
      where: { id: aiMessageId },
      data: { body: text, status: "done" },
    });
  } catch (err) {
    console.error("[team] AI reply failed:", err);
    await prisma.teamMessage
      .update({
        where: { id: aiMessageId },
        data: {
          body: "Sorry - I could not answer that. Please try again.",
          status: "failed",
        },
      })
      .catch(() => {});
  }
}
