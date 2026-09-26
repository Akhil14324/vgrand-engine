import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import {
  buildFinalPrompt,
  CAMPAIGN_CREATIVE_STYLE,
  resolveProvider,
} from "../lib/prompt.js";
import {
  getImageUsage,
  recordImageUsage,
  refundImageUsage,
} from "../lib/usage.js";
import { publishGenerationEvent } from "./events.js";
import {
  brandImageGuidance,
  brandReferenceUrls,
  loadBrandContext,
} from "../lib/brand.js";
import type { BrandProfile } from "@catgpt/types";
import {
  brandMessage,
  getClient,
  memoryMessage,
  contextMessage,
  toMessages,
  type HistoryTurn,
  streamChat,
  streamChatWithSearch,
} from "./chat.js";
import { enqueueGeneration } from "./queue.js";

/**
 * Campaign Builder — a sales-focused mode of normal chat, entered with
 * `/campaign`. The assistant interviews the user, then delivers a full
 * revenue-oriented campaign and (by default) two image creatives.
 *
 * State lives in the conversation itself: once any turn starts with
 * `/campaign`, the rest of that chat stays in campaign mode.
 */

const CAMPAIGN_PREFIX = /^\/campaign\b/i;
const MAX_CREATIVES = 2;
const DEFAULT_OPENER = "I want to plan a sales campaign.";

export const isCampaignPrompt = (prompt: string) => CAMPAIGN_PREFIX.test(prompt.trim());

export function stripCampaignPrefix(prompt: string): string {
  return prompt.trim().replace(CAMPAIGN_PREFIX, "").trim() || DEFAULT_OPENER;
}

export async function isCampaignConversation(
  conversationId: string,
): Promise<boolean> {
  // Conversation.campaign is set the first time a /campaign turn lands and the
  // migration backfilled older rows — one PK lookup, no prompt scans.
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { campaign: true },
  });
  return convo?.campaign ?? false;
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
Rules: skip any question the user already answered; never ask about things you can infer; after at most two rounds of questions, or if the user says "just build it", stop asking and build with clearly labelled assumptions. Understand Telugu requests, including natural Telugu-English mixing and transliteration. Respond in the user's language unless they ask for another language; keep campaign copy, scripts, and instructions in natural Telugu when the user writes in Telugu. Answer typos silently and never comment on spelling.

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
where N is the number of image creatives to generate: 2 after a full campaign, or the number the user asked for in their latest image request, capped at ${MAX_CREATIVES} (for "2 more" N is 2, not the running total). Never request or generate more than two images for one campaign response. When asked only for more images, reply in one or two sentences saying what you are creating, then the marker line. NEVER output the marker while you are still interviewing, and never mention the marker or explain it.`;

const CREATIVE_SYSTEM = `You write image-generation prompts for sales advertising creatives. Return JSON only: {"creatives":[{"title":"...","prompt":"..."}]}.

Each "prompt" must be complete and stand-alone (the image model sees nothing else): the product/offer, the scene, composition (vertical 4:5 Instagram feed post unless the conversation specifies another platform or aspect ratio), bright, clean, balanced lighting with even exposure, and the exact short on-image text - a headline, the offer and a call to action - written out in quotes and spelled exactly, every word letter-perfect. Hard rule on readability: the whole background stays light and clean (white, cream, pastel or bright daylight scene); NEVER place a dark panel, black gradient, smoke, vignette or scrim behind text, and every word must sit on a light, uncluttered area with strong contrast. No dark overlays, muddy color casts, underexposure or heavy shadows anywhere unless the user explicitly asks for a dark or dramatic look. Use the same language as the user's campaign request for on-image copy; use natural Telugu for Telugu prompts unless another language is requested. Do not put social-media captions or hashtags on the image; captions and hashtags are delivered separately as text. Use brand colours, product names and prices ONLY if the user gave them; never invent prices, phone numbers, discounts, awards or testimonials. Make every creative a genuinely different angle (for example hero product, offer + urgency, lifestyle / social proof, festive or seasonal) so the set can be A/B tested. "title" is a short label (max 6 words).

Never depict real people or public figures — politicians, celebrities, historical leaders. Image providers refuse their likenesses, so the creative would fail. For occasions tied to a person (birth anniversaries, memorial days, founder tributes), use symbolic imagery instead: their iconic objects, signature colours, a famous quote as text, or the event's symbols. If a brand mascot or character appears in a brief, render it as a small supporting cameo or accent — never the focal subject; the product and offer lead the composition.`;

export interface CampaignCalendarPlan {
  dates: string[];
  days: { date: string; relevantEvent: string | null; reason: string | null }[];
  sources: { title: string; url: string }[];
  researchNotes: string;
  verified: boolean;
}

function indiaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateList(start: string, count: number): string[] {
  const [year, month, day] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year!, month! - 1, day! + i));
    return date.toISOString().slice(0, 10);
  });
}

export function parseCampaignDateRange(
  prompt: string,
  now = new Date(),
): string[] | null {
  if (!/(calendar|festival|observance|occasion|holiday|panchang|indian\s+(?:calendar|festival|holiday)|(?:calendar|festival).{0,20}india|భారతీయ క్యాలెండర్|భారత క్యాలెండర్|పండుగ|పండుగలు)/i.test(prompt)) {
    return null;
  }
  const explicit = prompt.match(/\b(20\d{2}-\d{2}-\d{2})\s+(?:to|through|until|–|-)\s*(20\d{2}-\d{2}-\d{2})\b/i);
  if (explicit) {
    const start = new Date(`${explicit[1]}T00:00:00Z`);
    const end = new Date(`${explicit[2]}T00:00:00Z`);
    const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (
      Number.isFinite(span) &&
      span > 0 &&
      span <= 31 &&
      start.toISOString().slice(0, 10) === explicit[1] &&
      end.toISOString().slice(0, 10) === explicit[2]
    ) {
      return dateList(explicit[1]!, span);
    }
  }

  const duration = prompt.match(/\b(?:next|coming|upcoming|for(?: the)? next|over the next)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty)\s+(days?|weeks?)\b/i);
  const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30 };
  const amount = duration ? Number(duration[1]) || counts[duration[1]!.toLowerCase()] || 7 : 7;
  const count = Math.min(31, Math.max(1, duration?.[2]?.startsWith("week") ? amount * 7 : amount));
  const tomorrow = dateList(indiaDate(now), 2)[1]!;
  return dateList(tomorrow, count);
}

/**
 * Look up verified Indian calendar events for an explicit set of dates
 * (YYYY-MM-DD) and score each for relevance to the business. Used by both the
 * /campaign chat planner and the brand-page autopilot scheduler.
 */
export async function researchCalendarEvents(
  dates: string[],
  context: string,
  brand: string | null,
): Promise<CampaignCalendarPlan> {
  const emptyDays = dates.map((date) => ({ date, relevantEvent: null, reason: null }));
  let researchNotes = "";
  let sources: { title: string; url: string }[] = [];
  let days: CampaignCalendarPlan["days"] = emptyDays;
  let verified = false;
  try {
    const search = await streamChatWithSearch(
      `Find verified Indian calendar events falling on these exact dates: ${dates.join(", ")}. Include national days and observances, major festivals, and regional occasions only where relevant to the stated location/audience; include Telugu occasions when the brand location or audience indicates Telugu-speaking. Return a concise date-by-date candidate list, with region and source names. Do not invent events or move lunar-calendar dates. If none are found for a date, say none found.\n\nBusiness and campaign context:\n${context.slice(0, 6000)}`,
      [],
      [],
      [],
      () => {},
      () => {},
      brand,
    );
    researchNotes = search.text.slice(0, 5000);
    sources = search.sources;
    const assessment = await getClient().chat.completions.create({
      model: env.CAMPAIGN_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a calendar-event relevance evaluator. Use only candidate events in the supplied research; never add or infer an event. For every supplied date, select at most one event only if it is directly relevant to the business, audience, location, or campaign. Otherwise return null. Output JSON only with this shape and exactly one entry per requested date: {"days":[{"date":"YYYY-MM-DD","relevantEvent":null,"reason":null}]}.`,
        },
        {
          role: "user",
          content: `Business and campaign context:\n${context.slice(0, 6000)}\n\nRequested dates:\n${dates.join(", ")}\n\nCalendar search results:\n${researchNotes}`,
        },
      ],
    });
    const parsed = JSON.parse(assessment.choices[0]?.message.content ?? "{}") as {
      days?: { date?: string; relevantEvent?: string | null; reason?: string | null }[];
    };
    const byDate = new Map((parsed.days ?? []).map((day) => [day.date, day]));
    if (dates.every((date) => byDate.has(date))) {
      days = dates.map((date) => {
        const item = byDate.get(date)!;
        return {
          date,
          relevantEvent: item.relevantEvent?.trim() || null,
          reason: item.reason?.trim() || null,
        };
      });
      verified = true;
    }
  } catch {
    researchNotes = researchNotes || "Live Indian calendar lookup or event assessment was unavailable.";
  }
  return { dates, days, sources, researchNotes, verified };
}

export async function prepareCampaignCalendar(
  prompt: string,
  campaignContext: string,
  brand: string | null,
): Promise<CampaignCalendarPlan | null> {
  const dates = parseCampaignDateRange(prompt);
  if (!dates) return null;
  return researchCalendarEvents(
    dates,
    `User's calendar request:\n${prompt}\n\nBusiness and campaign context:\n${campaignContext.slice(0, 6000)}`,
    brand,
  );
}

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
  brand: string | null = null,
  calendarPlan: CampaignCalendarPlan | null = null,
): Promise<CampaignReply> {
  const stream = await getClient().chat.completions.create({
    model: env.CAMPAIGN_MODEL,
    stream: true,
    messages: [
      { role: "system", content: CAMPAIGN_SYSTEM },
      ...brandMessage(brand),
      ...(calendarPlan
        ? [
            {
              role: "system" as const,
              content: `Calendar-Aware Content Planning & Generation is active. Dates use India Standard Time (Asia/Kolkata): ${calendarPlan.dates.join(", ")}. Replace the generic posting schedule with exactly one dated content item for each requested date. First follow the per-date relevance assessment below, then combine relevant occasions with the existing business, audience, location, tone, offer, and content-pillar context. Cite a supplied source for each event-based item. For null events, create a normal post from the established strategy; never force or invent a festival. Include each item's content idea, platform/format, caption, and CTA.\n\nCalendar relevance assessment:\n${JSON.stringify(calendarPlan.days)}\n\nCalendar research notes:\n${calendarPlan.researchNotes}\n\nSources:\n${calendarPlan.sources.map((s) => `${s.title}: ${s.url}`).join("\n") || "No sources returned."}\n\nCalendar verification: ${calendarPlan.verified ? "live search and per-date relevance assessment completed" : "live calendar research could not be fully verified; use normal strategy and make no unsupported event claims"}.`},
          ]
        : []),
      ...(brand
        ? [
            {
              role: "system" as const,
              content:
                "A Brand Profile is provided above. Treat every fact in it as already answered in the interview: do not ask about it again. Ask only about what is genuinely missing (at most 3 questions), or go straight to the campaign if it is enough.",
            },
          ]
        : []),
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

export async function generateCampaignPostCopy(
  imageUrl: string,
  creativePrompt: string,
  history: HistoryTurn[],
  brand: string | null,
): Promise<string> {
  const campaignContext = history
    .slice(-8)
    .map(
      (turn) =>
        `User: ${turn.prompt.slice(0, 800)}\nAssistant: ${(turn.textResponse ?? "").slice(-1200)}`,
    )
    .join("\n\n")
    .slice(-6000);
  let trendNotes = "";
  try {
    const trends = await streamChatWithSearch(
      `Search for current social-media content or hashtag trends genuinely relevant to this campaign and image. Return at most 5 concise, sourced trend notes; do not invent trend data or popularity metrics. If no reliable current trend applies, say so and prefer evergreen relevant tags.\n\nCampaign context:\n${campaignContext}\n\nCreative brief:\n${creativePrompt.slice(0, 1200)}`,
      [],
      [],
      [],
      () => {},
      () => {},
      brand,
    );
    trendNotes = trends.text.slice(0, 2500);
  } catch {
    trendNotes = "No live trend results were available; use relevant evergreen hashtags and do not claim a tag is trending.";
  }

  return streamChat(
    `Analyze the attached generated campaign image itself, then write a ready-to-post social caption and 5–8 relevant hashtags based on the visible image, the campaign context, and these live trend notes. Keep the caption in the language used by the campaign user (use natural Telugu for a Telugu request unless another language was requested). Do not invent prices, offers, features, or claims. Do not put the caption or hashtags in the image; return them only as text in exactly this format:\nCaption: <caption>\n\nHashtags: #tag1 #tag2 ...\n\nCampaign context:\n${campaignContext}\n\nCreative brief:\n${creativePrompt.slice(0, 1200)}\n\nLive trend notes:\n${trendNotes}`,
    [],
    [],
    [],
    "chat",
    () => {},
    brand,
    [imageUrl],
  );
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
  brandId?: string | null;
}): Promise<string | null> {
  const { userId, conversationId, requested } = params;
  const brand = params.brandId
    ? await loadBrandContext(params.brandId, userId)
    : null;
  const brandRefs = brand
    ? brandReferenceUrls(brand.assets, brand.mascot?.asset.url)
    : [];
  const guidance = brand
    ? brandImageGuidance(
        brand.name,
        (brand.profile ?? {}) as BrandProfile,
        brand.assets.some((a) => a.kind === "logo"),
        brand.mascot,
      )
    : "";
  const usage = await getImageUsage(userId);
  const count = Math.min(requested, MAX_CREATIVES, usage.remaining);
  if (count <= 0) {
    return `\n\n> No image creatives were generated - you have used today's ${usage.limit} images. It resets at midnight UTC.`;
  }

  const briefs = await planCreatives(
    params.history,
    params.userPrompt,
    params.reply,
    count,
  );
  let spawned = 0;
  let hitQuota = false;
  for (const [i, brief] of briefs.entries()) {
    const generation = await prisma.generation.create({
      data: {
        userId,
        conversationId,
        kind: "image",
        prompt: brief.prompt,
        finalPrompt:
          buildFinalPrompt(null, brief.prompt) +
          guidance +
          CAMPAIGN_CREATIVE_STYLE,
        provider: resolveProvider(null),
        metadata: {
          quality: env.CAMPAIGN_IMAGE_QUALITY,
          size: "1088x1360",
          ...(brandRefs.length
            ? { referenceImageUrl: brandRefs[0], referenceImageUrls: brandRefs }
            : {}),
          ...(params.brandId ? { brandId: params.brandId } : {}),
          campaignCreative: {
            index: i + 1,
            total: briefs.length,
            title: brief.title,
          },
        },
      },
    });
    // The quota snapshot that picked `count` is stale by now — reserve
    // atomically per creative so concurrent sends can't overspend the limit.
    const reserved = await recordImageUsage(userId, generation.id);
    if (!reserved) {
      hitQuota = true;
      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed", error: "Daily image limit reached" },
      });
      publishGenerationEvent({
        generationId: generation.id,
        status: "failed",
        error: "Daily image limit reached",
      });
      break;
    }
    try {
      await enqueueGeneration(generation.id, { background: true });
      spawned++;
    } catch (err) {
      // Same contract as POST /generations: a job that never starts must not
      // stay pending or stay charged.
      await refundImageUsage(generation.id).catch(() => {});
      await prisma.generation
        .update({
          where: { id: generation.id },
          data: { status: "failed", error: "Could not start the job" },
        })
        .catch(() => {});
      publishGenerationEvent({
        generationId: generation.id,
        status: "failed",
        error: "Could not start the job",
      });
      console.error("[campaign] creative enqueue failed:", err);
      break;
    }
  }
  if (spawned < requested) {
    if (hitQuota) {
      return `\n\n> Generated ${spawned} of ${requested} creatives - that is all the images you have left today.`;
    }
    return `\n\n> Only ${spawned} of ${requested} creatives could be started — ask me to retry the rest.`;
  }
  return null;
}
