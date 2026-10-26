import { Prisma, prisma } from "@catgpt/db";
import { reelBriefSchema, type BrandProfile, type ReelBrief, type ReelScript } from "@catgpt/types";
import { env } from "../env.js";
import { getClient } from "./chat.js";
import {
  buildFootageInventory,
  buildScriptMessages,
  checkScriptOutput,
  forbiddenTermsLine,
} from "./video-script-logic.js";

const MAX_ATTEMPTS = 2;

/**
 * Writes the reel script with the chat model. A failed check gets one retry
 * with the problems listed; a second failure is returned as an error instead of
 * a half-valid script.
 */
export async function requestReelScript(input: {
  brandSummary: string;
  profile: BrandProfile | null;
  brief: ReelBrief;
  title: string;
  footage: Parameters<typeof buildFootageInventory>[0];
}): Promise<ReelScript> {
  const inventory = buildFootageInventory(input.footage);
  const forbidden = forbiddenTermsLine(input.profile);
  let problems: string[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: buildScriptMessages({
        brandSummary: input.brandSummary,
        forbidden,
        brief: input.brief,
        title: input.title,
        inventory,
        problems,
      }),
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const checked = checkScriptOutput(raw, input.brief.durationSec);
    if (checked.ok) return checked.script;
    problems = checked.problems;
  }
  throw new Error(`script failed checks: ${problems?.join(" ")}`);
}

/**
 * Runs in the background after the route has claimed the project (status
 * `scripting`). Ends in `scripted` or `failed`. The error text stored on the row
 * is generic; the detail goes to the server log.
 */
export async function runScriptJob(projectId: string): Promise<void> {
  try {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        folder: { include: { assets: { orderBy: { createdAt: "asc" } } } },
        brand: { select: { name: true, summary: true, profile: true } },
      },
    });
    if (!project) return;

    const brief = reelBriefSchema.parse(project.brief);
    const footage = project.folder?.assets ?? [];
    const script = await requestReelScript({
      brandSummary: project.brand.summary || project.brand.name,
      profile: (project.brand.profile as BrandProfile | null) ?? null,
      brief,
      title: project.title,
      footage,
    });

    await prisma.videoProject.updateMany({
      where: { id: projectId, status: "scripting" },
      data: { script: script as unknown as Prisma.InputJsonValue, status: "scripted", errorMessage: null },
    });
  } catch (err) {
    console.error("[video-script] failed", projectId, err);
    await prisma.videoProject.updateMany({
      where: { id: projectId, status: "scripting" },
      data: {
        status: "failed",
        errorMessage: "The script could not be written. Try again.",
      },
    });
  }
}
