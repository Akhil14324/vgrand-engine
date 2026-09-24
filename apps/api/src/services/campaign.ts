import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import { buildFinalPrompt, resolveProvider } from "../lib/prompt.js";
import { getImageUsage, recordImageUsage } from "../lib/usage.js";
import {
  getClient,
  memoryMessage,
  contextMessage,
  toMessages,
  type HistoryTurn,
} from "./chat.js";
import { enqueueGeneration } from "./queue.js";

/**
 * Campaign Builder — a sales-focused mode of normal chat, entered with
 * `/campaign`. The assistant interviews the user, then delivers a full
 * revenue-oriented campaign and (by default) three image creatives.
 *
 * State lives in the conversation itself: once any turn starts with
 * `/campaign`, the rest of that chat stays in campaign mode.
 */

const CAMPAIGN_PREFIX = /^\/campaign\b/i;
const MAX_CREATIVES = 10;
const DEFAULT_OPENER = "I want to plan a sales campaign.";

export const isCampaignPrompt = (prompt: string) => CAMPAIGN_PREFIX.test(prompt.trim());

export function stripCampaignPrefix(prompt: string): string {
  return prompt.trim().replace(CAMPAIGN_PREFIX, "").trim() || DEFAULT_OPENER;
}

export async function isCampaignConversation(
  conversationId: string,
): Promise<boolean> {
  const first = await prisma.generation.findFirst({
    where: {
      conversationId,
      prompt: { startsWith: "/campaign", mode: "insensitive" },
    },
    select: { id: true },
  });
  return first !== null;
}

/* --------------------------------- prompts -------------------------------- */

const CAMPAIGN_SYSTEM = `You are CatGPT's Campaign Strategist. Your single goal is to help the user MAKE MORE MONEY: more sales, higher order value, more repeat customers. Everything you produce must tie back to revenue.

## Phase 1 - Interview (before you build anything)
You need real facts to build a campaign that sells. If the user has not given them, ask - do NOT guess and do NOT build yet. Ask in ONE numbered list of at most 6 short questions, covering what is missing from:
1. What exactly do they sell, and at what price? (and rough margin / cost per unit)
2. Who buys it - the ideal customer, and where they are (city / region / online)?
3. The goal in numbers - revenue or order target, and by when?
4. Where do they sell and promote today (Instagram, WhatsApp, Google, walk-ins, marketplace...) and what results do they get now?
5. Marketing budget for this campaign, and who does the work (just them, a team)?
6. What makes them different from competitors, and any existing offers, reviews, photos or brand colours?
Rules: skip any question the user already answered; never ask about things you can infer; after at most two rounds of questions, or if the user says "just build it", stop asking and build with clearly labelled assumptions. Answer typos and mixed English/Telugu silently, never comment on spelling.

## Phase 2 - The campaign (once you have enough)
Write a complete, practical, revenue-first campaign in Markdown with these sections:
1. **Goal & the math** - restate the target, then work backwards: revenue -> orders -> leads/visitors needed, using the user's own numbers. Show unit economics (price, cost, margin), break-even, target CAC and ROAS, expected AOV. Any conversion rate or benchmark you are not given is an ASSUMPTION - label it "assumption" and say how to replace it with real data.
2. **Offer & positioning** - the core offer (bundle, discount logic that protects margin, guarantee, urgency), the one-line promise, and why it beats competitors.
3. **Customer & funnel** - who to target, then the funnel: awareness -> interest -> purchase -> repeat, with what happens at each step.
4. **Channels & budget split** - which channels, why, and how the budget is divided (table with amounts or percentages).
5. **Ready-to-post copy** - per chosen channel: hook, caption/body, and call to action, written and ready to paste. Include WhatsApp/DM sales scripts and replies to the top objections.
6. **Content & posting calendar** - day-by-day for the campaign length, including a retargeting / follow-up sequence and a repeat-purchase / referral step.
7. **Metrics & KPI table** - a Markdown table that MUST contain a row for EACH of these 14 metrics (none may be skipped), with a formula, a target and how often to check: reach/impressions, CTR, CPC, lead rate (landing or DM-to-lead), lead-to-sale conversion rate, CPA/CAC, AOV, ROAS, revenue, gross margin, repeat purchase rate, LTV, LTV:CAC, refund/churn rate. Targets must come from the user's numbers or be marked as assumptions.
8. **Test plan** - 3-5 A/B tests ranked by expected revenue impact, with what to change and how to call a winner.
9. **Weekly review routine & risks** - what to check each week, what to cut or scale, and the top risks with fixes.
10. **Creatives** - one line on each image creative that will be generated.

Honesty rules: never invent statistics, market sizes, competitor facts, testimonials, prices or phone numbers. Use only what the user told you, and label everything else as an assumption or as a benchmark to verify. A discount, bundle or price change you propose is a SUGGESTION - call it "suggested offer" and show its margin impact; never present it as something the user already runs. Be direct and specific; no filler.

## Images
The system generates the image creatives for you. After you deliver a full campaign, OR when the user asks for (more) campaign images/creatives/posters, end your message with a final line that is exactly:
<<CAMPAIGN_READY:N>>
where N is the number of image creatives to generate: 3 after a full campaign, or EXACTLY the number the user asked for in their latest message (for "2 more" N is 2, not the running total; maximum ${MAX_CREATIVES}). When asked only for more images, reply in one or two sentences saying what you are creating, then the marker line. NEVER output the marker while you are still interviewing, and never mention the marker or explain it.`;

const CREATIVE_SYSTEM = `You write image-generation prompts for sales advertising creatives. Return JSON only: {"creatives":[{"title":"...","prompt":"..."}]}.

Each "prompt" must be complete and stand-alone (the image model sees nothing else): the product/offer, the scene, composition (square social-media post unless the conversation says otherwise), lighting and style, and the exact short on-image text - a headline, the offer and a call to action - written out in quotes and spelled exactly. Use brand colours, product names and prices ONLY if the user gave them; never invent prices, phone numbers, discounts, awards or testimonials. Make every creative a genuinely different angle (for example hero product, offer + urgency, lifestyle / social proof, festive or seasonal) so the set can be A/B tested. "title" is a short label (max 6 words).`;

/* ----------------------------- marker filtering ---------------------------- */

const MARKER = /<<CAMPAIGN_READY:(\d{1,2})>>/;
const MARKER_HEAD = "<<CAMPAIGN_READY:";
const MARKER_PARTIAL = /^<<CAMPAIGN_READY:\d{0,2}>?$/;

/**
 * Removes the machine-readable `<<CAMPAIGN_READY:N>>` line from a token stream
 * without the user ever seeing it: any tail that could still turn into the
 * marker is held back until it is resolved.
 */
export class MarkerFilter {
  private buf = "";
  count: number | null = null;

  push(delta: string): string {
    this.buf += delta;
    const m = MARKER.exec(this.buf);
    if (m) {
      this.count = Math.min(Number(m[1]), MAX_CREATIVES);
      this.buf = this.buf.replace(MARKER, "");
    }
    let hold = this.buf.length;
    const idx = this.buf.lastIndexOf("<<");
    if (idx !== -1 && MarkerFilter.couldBeMarker(this.buf.slice(idx))) hold = idx;
    // A lone trailing "<" may be the first half of "<<".
    if (hold === this.buf.length && this.buf.endsWith("<")) hold = this.buf.length - 1;
    const out = this.buf.slice(0, hold);
    this.buf = this.buf.slice(hold);
    return out;
  }

  private static couldBeMarker(tail: string): boolean {
    return MARKER_HEAD.startsWith(tail) || MARKER_PARTIAL.test(tail);
  }

  /** End of stream: a held, unfinished marker is dropped; anything else is text. */
  flush(): string {
    const idx = this.buf.lastIndexOf("<<");
    const rest =
      idx !== -1 && MarkerFilter.couldBeMarker(this.buf.slice(idx))
        ? this.buf.slice(0, idx)
        : this.buf;
    this.buf = "";
    return rest;
  }
}

/* --------------------------------- the chat -------------------------------- */

export interface CampaignReply {
  text: string;
  /** Number of image creatives to generate (0 while still interviewing). */
  creativeCount: number;
}

export async function streamCampaign(
  prompt: string,
  history: HistoryTurn[],
  context: string[],
  memories: string[],
  onDelta: (delta: string) => void,
): Promise<CampaignReply> {
  const stream = await getClient().chat.completions.create({
    model: env.CAMPAIGN_MODEL,
    stream: true,
    messages: [
      { role: "system", content: CAMPAIGN_SYSTEM },
      ...memoryMessage(memories),
      ...contextMessage(context),
      ...toMessages(history),
      { role: "user", content: prompt },
    ],
  });

  const filter = new MarkerFilter();
  let text = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) continue;
    const safe = filter.push(delta);
    if (safe) {
      text += safe;
      onDelta(safe);
    }
  }
  const rest = filter.flush();
  if (rest) {
    text += rest;
    onDelta(rest);
  }
  text = text.trimEnd();
  if (!text.trim()) throw new Error("campaign model returned an empty response");
  return { text, creativeCount: filter.count ?? 0 };
}

/* -------------------------------- creatives -------------------------------- */

interface Creative {
  title: string;
  prompt: string;
}

async function planCreatives(
  history: HistoryTurn[],
  userPrompt: string,
  reply: string,
  count: number,
): Promise<Creative[]> {
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CREATIVE_SYSTEM },
      ...toMessages(history.slice(-6)),
      { role: "user", content: userPrompt },
      { role: "assistant", content: reply },
      {
        role: "user",
        content: `Write exactly ${count} image prompts for this campaign as JSON.`,
      },
    ],
  });
  const raw = res.choices[0]?.message.content ?? "{}";
  const parsed = JSON.parse(raw) as { creatives?: Partial<Creative>[] };
  return (parsed.creatives ?? [])
    .filter((c): c is Creative => Boolean(c.prompt?.trim()))
    .map((c) => ({ title: c.title?.trim() ?? "", prompt: c.prompt.trim() }))
    .slice(0, count);
}

/**
 * Turns the assistant's plan into real image generations in the same chat.
 * Each one is a normal image job: it counts toward the user's daily limit, so
 * the number created is capped by what they have left today.
 * Returns a note for the user when fewer than requested were created.
 */
export async function spawnCreatives(params: {
  userId: string;
  conversationId: string;
  history: HistoryTurn[];
  userPrompt: string;
  reply: string;
  requested: number;
}): Promise<string | null> {
  const { userId, conversationId, requested } = params;
  const usage = await getImageUsage(userId);
  const count = Math.min(requested, usage.remaining);
  if (count <= 0) {
    return `\n\n> No image creatives were generated - you have used today's ${usage.limit} images. It resets at midnight UTC.`;
  }

  const briefs = await planCreatives(
    params.history,
    params.userPrompt,
    params.reply,
    count,
  );
  for (const [i, brief] of briefs.entries()) {
    const generation = await prisma.generation.create({
      data: {
        userId,
        conversationId,
        kind: "image",
        prompt: brief.prompt,
        finalPrompt: buildFinalPrompt(null, brief.prompt),
        provider: resolveProvider(null),
        metadata: {
          quality: env.CAMPAIGN_IMAGE_QUALITY,
          size: "auto",
          campaignCreative: {
            index: i + 1,
            total: briefs.length,
            title: brief.title,
          },
        },
      },
    });
    await recordImageUsage(userId, generation.id);
    await enqueueGeneration(generation.id);
  }
  if (briefs.length < requested) {
    return briefs.length < count
      ? `\n\n> Only ${briefs.length} of ${requested} creatives could be planned.`
      : `\n\n> Generated ${briefs.length} of ${requested} creatives - that is all the images you have left today.`;
  }
  return null;
}
