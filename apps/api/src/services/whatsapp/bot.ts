import { prisma, type WhatsappContact, type WhatsappMessage, type WhatsappNumber } from "@catgpt/db";
import { waMenuItemSchema, type WaMenuItem } from "@catgpt/types";
import { env } from "../../env.js";
import { loadBrandContext } from "../../lib/brand.js";
import { getClient } from "../chat.js";
import { findScopeDocuments, retrievePassages } from "../documents.js";
import { advanceStage, menuItemFromReply, parseAiReply, wantsHuman, REPLY_WINDOW_MS } from "./logic.js";
import { decryptToken } from "../../lib/social-crypto.js";
import { markReadTyping } from "./graph.js";
import { sendImage, sendMenu, sendText } from "./send.js";

const ms = (t0: number) => Date.now() - t0;
const timing = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", scope: "whatsapp", event, ...data }));

/**
 * The inbound lead bot. Modes per number: off | menu | ai | hybrid.
 *  - menu:   greeting + tap menu; every free-text message gets the menu again.
 *  - ai:     the model answers from the brand's profile and PDFs and captures lead fields.
 *  - hybrid: greeting + menu on a new conversation, then the AI handles free text.
 * A human takeover (botPaused) or a handoff keyword silences the bot.
 */

const DEFAULT_GREETING = "Hi! Thanks for reaching out. How can we help you today?";
const DEFAULT_HANDOFF = "Sure, one of our team will message you here shortly.";

export const menuOf = (n: WhatsappNumber): WaMenuItem[] => {
  const raw = Array.isArray(n.menu) ? n.menu : [];
  return raw.flatMap((m) => {
    const p = waMenuItemSchema.safeParse(m);
    return p.success ? [p.data] : [];
  });
};

async function handoff(number: WhatsappNumber, contact: WhatsappContact): Promise<void> {
  await prisma.whatsappContact.update({ where: { id: contact.id }, data: { botPaused: true, stage: contact.stage === "new" ? "engaged" : contact.stage } });
  await sendText(number, contact, number.handoffMessage || DEFAULT_HANDOFF, "bot");
}

async function isNewConversation(number: WhatsappNumber, contact: WhatsappContact, current: WhatsappMessage): Promise<boolean> {
  const prev = await prisma.whatsappMessage.findFirst({
    where: { numberId: number.id, contactId: contact.id, id: { not: current.id }, createdAt: { lt: current.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return !prev || current.createdAt.getTime() - prev.createdAt.getTime() > REPLY_WINDOW_MS;
}

async function runMenuItem(number: WhatsappNumber, contact: WhatsappContact, item: WaMenuItem, current: WhatsappMessage): Promise<void> {
  if (item.kind === "human") return handoff(number, contact);
  if (item.kind === "capture") return aiTurn(number, contact, current, `The customer tapped "${item.title}". Start qualifying them: greet by name if known and ask the first missing question.`);
  const text = [item.text, item.kind === "link" && item.url ? item.url : ""].filter(Boolean).join("\n");
  if (item.imageUrl) await sendImage(number, contact, item.imageUrl, text, "bot");
  else if (text) await sendText(number, contact, text, "bot");
  if (contact.stage === "new") await prisma.whatsappContact.update({ where: { id: contact.id }, data: { stage: "engaged" } });
}

export async function handleInbound(messageId: string): Promise<void> {
  const t0 = Date.now();
  const msg = await prisma.whatsappMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.direction !== "in") return;
  const [number, contact, answered] = await Promise.all([
    prisma.whatsappNumber.findUnique({ where: { id: msg.numberId } }),
    prisma.whatsappContact.findUnique({ where: { id: msg.contactId } }),
    // A reply sent after this message means it was already handled (retry) or a human answered.
    prisma.whatsappMessage.findFirst({ where: { contactId: msg.contactId, direction: "out", createdAt: { gt: msg.createdAt }, source: { in: ["bot", "human"] } }, select: { id: true } }),
  ]);
  if (!number || !contact || number.status !== "active" || number.botMode === "off" || contact.botPaused || answered) return;
  // Read ticks + "typing…" right away so the customer sees life while we work.
  if (msg.waMessageId) void markReadTyping(decryptToken(number.accessTokenEnc), number.phoneNumberId, msg.waMessageId);
  timing("bot.start", { messageId, waitedMs: Date.now() - msg.createdAt.getTime(), setupMs: ms(t0) });

  const menu = menuOf(number);
  const tapped = menuItemFromReply(msg.replyId, menu);
  if (tapped) return runMenuItem(number, contact, tapped, msg);

  const text = msg.text ?? "";
  if (msg.type !== "text" && !text) {
    // Voice notes, photos, locations: the bot can't read them, so a person should.
    return handoff(number, contact);
  }
  if (wantsHuman(text, number.handoffKeywords)) return handoff(number, contact);

  const fresh = await isNewConversation(number, contact, msg);
  const greeting = number.greeting || DEFAULT_GREETING;
  if (number.botMode === "menu" || (number.botMode === "hybrid" && fresh)) {
    if (menu.length) return sendMenu(number, contact, greeting, menu);
    if (number.botMode === "menu") return sendText(number, contact, greeting, "bot");
  }
  if (number.botMode === "ai" && fresh) await sendText(number, contact, greeting, "bot");
  return aiTurn(number, contact, msg, null);
}

const FIELD_HELP = "name, budget (e.g. 80 lakh), bhk (1/2/3/4), location (preferred area), timeline (when they plan to buy), purpose (own use or investment)";

async function aiTurn(number: WhatsappNumber, contact: WhatsappContact, current: WhatsappMessage, hint: string | null): Promise<void> {
  if (!env.OPENAI_API_KEY) return handoff(number, contact);
  const t0 = Date.now();
  const question = current.text || hint || "";
  const [brand, docs, history] = await Promise.all([
    loadBrandContext(number.brandId),
    findScopeDocuments({ conversationId: null, workspaceId: null, brandId: number.brandId }).catch(() => []),
    prisma.whatsappMessage.findMany({ where: { contactId: contact.id }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const tLoad = ms(t0);
  let passages: string[] = [];
  try {
    passages = await retrievePassages(question, docs.map((d) => d.id));
  } catch (err) {
    console.warn("[whatsapp] retrieval failed", (err as Error).message);
  }
  const tRag = ms(t0) - tLoad;
  const known = { name: contact.name, ...(contact.fields as Record<string, string>) };

  const system = [
    `You are the WhatsApp assistant for ${brand?.name ?? "this real-estate brand"}. You talk to people interested in its flats and projects.`,
    brand?.summary ? `ABOUT THE BRAND:\n${brand.summary}` : "",
    passages.length ? `FACTS FROM THE BRAND'S DOCUMENTS (brochures, price sheets):\n${passages.join("\n---\n")}` : "",
    number.aiInstructions ? `OWNER'S INSTRUCTIONS:\n${number.aiInstructions}` : "",
    `ALREADY KNOWN ABOUT THIS PERSON: ${JSON.stringify(known)}`,
    [
      "RULES:",
      "- Use only the facts above. Never invent prices, availability, dates, approvals or offers. If you don't have it, say a team member will confirm and set handoff true.",
      "- Reply like WhatsApp: short, warm, plain text, max ~60 words, no markdown. Match the customer's language (English, Hindi, Telugu, etc.).",
      `- Qualify gently, ONE question at a time, never re-ask something already known. Fields you may capture: ${FIELD_HELP}.`,
      "- When they seem ready, offer a site visit and ask for a day/time.",
      "- Set handoff true if they ask for a person, are upset, ask about legal/loan/payment specifics, or want to negotiate.",
      'Answer ONLY with JSON: {"reply": string, "fields": {key: value}, "handoff": boolean, "stage": "engaged"|"qualified"|"site_visit"|null}. "fields" holds only values the customer stated in this chat. Use "qualified" once budget plus one of bhk/location are known; "site_visit" once they agree to visit.',
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const turns = history.reverse().map((m) => ({ role: m.direction === "in" ? ("user" as const) : ("assistant" as const), content: m.text ?? `[${m.type}]` }));
  if (hint) turns.push({ role: "user", content: `(system note, not from the customer) ${hint}` });

  let raw = "";
  try {
    const res = await getClient().chat.completions.create({
      model: env.WHATSAPP_MODEL,
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, ...turns],
    });
    raw = res.choices[0]?.message.content ?? "";
  } catch (err) {
    console.warn("[whatsapp] ai turn failed", (err as Error).message);
    return handoff(number, contact);
  }
  const tModel = ms(t0) - tLoad - tRag;
  const turn = parseAiReply(raw);
  if (turn.reply) await sendText(number, contact, turn.reply, "bot");
  timing("bot.ai", { model: env.WHATSAPP_MODEL, loadMs: tLoad, ragMs: tRag, modelMs: tModel, sendMs: ms(t0) - tLoad - tRag - tModel, passages: passages.length });

  const fields = { ...(contact.fields as Record<string, string>), ...turn.fields };
  const { name, ...rest } = fields;
  await prisma.whatsappContact.update({
    where: { id: contact.id },
    data: {
      fields: rest,
      name: contact.name || name || undefined,
      stage: advanceStage(contact.stage, turn.stage ?? "engaged"),
    },
  });
  if (turn.handoff || !turn.reply) await handoff(number, { ...contact, botPaused: false }).catch(() => {});
}
