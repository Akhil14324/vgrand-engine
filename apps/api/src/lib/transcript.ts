import { prisma } from "@catgpt/db";

/** Completed turns of a chat, oldest first - what exports and share links show. */
export async function loadTranscript(conversationId: string, limit = 300) {
  return prisma.generation.findMany({
    where: { conversationId, status: "completed" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      prompt: true,
      kind: true,
      textResponse: true,
      imageUrls: true,
      createdAt: true,
      metadata: true,
    },
  });
}

type Turn = Awaited<ReturnType<typeof loadTranscript>>[number];

/** The prompt as the user would recognise it (campaign creatives get a label). */
function promptLabel(t: Turn): string {
  const c = (t.metadata as Record<string, unknown> | null)?.campaignCreative as
    | { index: number; total: number; title?: string }
    | undefined;
  return c
    ? `Campaign creative ${c.index}/${c.total}${c.title ? ` - ${c.title}` : ""}`
    : t.prompt;
}

export function promptForDisplay(t: Turn) {
  return promptLabel(t);
}

/** Markdown transcript used by the .md and PDF exports. */
export function transcriptMarkdown(title: string, turns: Turn[]): string {
  const parts = [`# ${title}`];
  for (const t of turns) {
    parts.push(`**You:** ${promptLabel(t)}`);
    if (t.kind === "text" && t.textResponse) {
      parts.push(`**CatGPT:**\n\n${t.textResponse}`);
    } else if (t.imageUrls.length) {
      parts.push(
        "**CatGPT:** " +
          t.imageUrls.map((u, i) => `[generated image ${i + 1}](${u})`).join(", "),
      );
    }
  }
  return parts.join("\n\n---\n\n") + "\n";
}
