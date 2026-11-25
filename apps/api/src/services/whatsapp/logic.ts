import type { WaButton, WaMenuItem, WaTemplateInput } from "@catgpt/types";

/**
 * WhatsApp Cloud API: pure rules. No I/O, so the webhook, the bot, broadcasts
 * and the tests share one definition. Meta limits used here: free-form replies
 * only within 24 h of the customer's last message; reply buttons max 3 (title
 * 20 chars); list rows max 10 (title 24); text body max 4096; template body 1024.
 */

export const REPLY_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_TEXT = 4096;

/** Digits only, international. A bare 10-digit number gets the default country code. */
export function normalizePhone(raw: string, defaultCountry = "91"): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  const plus = d.startsWith("+");
  d = d.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.length === 10) d = defaultCountry + d;
  else if (!plus && d.length === 11 && d.startsWith("0")) d = defaultCountry + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export const canFreeReply = (lastInboundAt: Date | null | undefined, now = new Date()): boolean =>
  !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < REPLY_WINDOW_MS;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

export const isOptOut = (text: string): boolean => /^(stop|unsubscribe|opt ?out|cancel messages?)\W*$/.test(norm(text));
export const isOptIn = (text: string): boolean => /^(start|subscribe|opt ?in)\W*$/.test(norm(text));

export function wantsHuman(text: string, keywords: string[]): boolean {
  const t = ` ${norm(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
  const defaults = ["human", "agent", "executive", "representative", "call me", "talk to someone"];
  return [...defaults, ...keywords].some((k) => {
    const n = norm(k).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    return n.length > 0 && t.includes(` ${n} `);
  });
}

/** Splits long text at paragraph/sentence boundaries to fit WhatsApp's limit. */
export function splitText(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(". ", max) + 1;
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/* ------------------------------- webhook parse ------------------------------ */

export interface InboundMessage {
  kind: "message";
  phoneNumberId: string;
  waId: string;
  profileName: string | null;
  mid: string;
  type: string;
  text: string | null;
  /** id of a tapped menu item (button or list reply), if any */
  replyId: string | null;
  occurredAt: Date;
}
export interface StatusUpdate {
  kind: "status";
  phoneNumberId: string;
  mid: string;
  status: "sent" | "delivered" | "read" | "failed";
  error: string | null;
  occurredAt: Date;
}
export type WaEvent = InboundMessage | StatusUpdate;

type Json = Record<string, any>;

export function parseWebhook(body: unknown): WaEvent[] {
  const out: WaEvent[] = [];
  const b = body as Json | null;
  if (!b || b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return out;
  for (const entry of b.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const v: Json = change.value ?? {};
      const phoneNumberId = String(v.metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue;
      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) if (c?.wa_id) names.set(String(c.wa_id), String(c.profile?.name ?? ""));
      for (const m of v.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        const type = String(m.type ?? "unknown");
        let text: string | null = null;
        let replyId: string | null = null;
        if (type === "text") text = String(m.text?.body ?? "");
        else if (type === "button") {
          text = String(m.button?.text ?? "");
          replyId = m.button?.payload ? String(m.button.payload) : null;
        } else if (type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          text = r?.title ? String(r.title) : null;
          replyId = r?.id ? String(r.id) : null;
        } else if (["image", "video", "document", "audio"].includes(type)) text = String(m[type]?.caption ?? "") || null;
        out.push({
          kind: "message",
          phoneNumberId,
          waId: String(m.from),
          profileName: names.get(String(m.from)) || null,
          mid: String(m.id),
          type,
          text,
          replyId,
          occurredAt: new Date(Number(m.timestamp) * 1000 || Date.now()),
        });
      }
      for (const s of v.statuses ?? []) {
        if (!s?.id || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        out.push({
          kind: "status",
          phoneNumberId,
          mid: String(s.id),
          status: s.status,
          error: s.errors?.[0] ? `${s.errors[0].title ?? s.errors[0].message ?? "failed"} (${s.errors[0].code ?? "?"})` : null,
          occurredAt: new Date(Number(s.timestamp) * 1000 || Date.now()),
        });
      }
    }
  }
  return out;
}

/* ------------------------------- menu payloads ------------------------------ */

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Interactive message: up to 3 items become reply buttons, 4-10 become a list. */
export function buildMenuPayload(to: string, body: string, items: WaMenuItem[]): Record<string, unknown> {
  const text = clip(body || "How can we help you today?", 1024);
  if (items.length <= 3) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: { buttons: items.map((i) => ({ type: "reply", reply: { id: `m:${i.id}`, title: clip(i.title, 20) } })) },
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text },
      action: { button: "See options", sections: [{ title: "Options", rows: items.slice(0, 10).map((i) => ({ id: `m:${i.id}`, title: clip(i.title, 24) })) }] },
    },
  };
}

export const menuItemFromReply = (replyId: string | null, menu: WaMenuItem[]): WaMenuItem | null =>
  replyId?.startsWith("m:") ? (menu.find((i) => i.id === replyId.slice(2)) ?? null) : null;

/* --------------------------------- templates -------------------------------- */

export const placeholderCount = (body: string): number => new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;

/** Returns a problem description, or null when the template can be submitted. */
export function validateTemplate(t: WaTemplateInput): string | null {
  const n = placeholderCount(t.body);
  const nums = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (nums.length && new Set(nums).size !== Math.max(...nums)) return "Placeholders must be {{1}}, {{2}}, ... without gaps";
  if (t.variables.length !== n) return `Name each of the ${n} placeholders (got ${t.variables.length})`;
  if (t.examples.length !== n) return `Give an example value for each of the ${n} placeholders`;
  if (/^\s*\{\{|\{\{\d+\}\}\s*$/.test(t.body)) return "Meta rejects bodies that start or end with a placeholder; add some text around it";
  return null;
}

/** Body of POST /{waba}/message_templates. */
export function templateToMeta(t: WaTemplateInput): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (t.headerUrl) components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [t.headerUrl] } });
  components.push({
    type: "BODY",
    text: t.body,
    ...(t.examples.length ? { example: { body_text: [t.examples] } } : {}),
  });
  if (t.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: t.buttons.map((b: WaButton) =>
        b.type === "url" ? { type: "URL", text: b.text, url: b.url } : b.type === "phone" ? { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone } : { type: "QUICK_REPLY", text: b.text },
      ),
    });
  }
  return { name: t.name, language: t.language, category: t.category, components };
}

/** Fills {{n}} for previews and the stored message text. */
export const renderTemplateBody = (body: string, values: string[]): string => body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] ?? "");

/** Resolves one variable spec ("name" | "field:<key>" | "text:<literal>") for a contact. */
export function resolveVariable(spec: string, c: { name: string | null; fields: Record<string, string> }): string {
  if (spec === "name") return c.name?.trim().split(/\s+/)[0] || "there";
  if (spec.startsWith("field:")) return c.fields[spec.slice(6)] || "";
  if (spec.startsWith("text:")) return spec.slice(5);
  return "";
}

/** Meta error code 131026/131047 etc. mean "can't deliver"; 131056 is pair rate limit. */
export const isRetryableCode = (code: number | null): boolean => code === 131056 || code === 130429 || code === 80007 || code === 131000;

/* ---------------------------------- AI bot ---------------------------------- */

export interface AiTurn {
  reply: string;
  fields: Record<string, string>;
  handoff: boolean;
  stage: "engaged" | "qualified" | "site_visit" | null;
}

/** The model must answer in JSON; anything else is treated as a plain reply. */
export function parseAiReply(raw: string): AiTurn {
  const empty: AiTurn = { reply: "", fields: {}, handoff: false, stage: null };
  try {
    const j = JSON.parse(raw) as Json;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.fields ?? {})) {
      if (/^[a-z_]{2,20}$/.test(k) && (typeof v === "string" || typeof v === "number") && String(v).trim()) fields[k] = String(v).trim().slice(0, 200);
    }
    const stage = ["engaged", "qualified", "site_visit"].includes(j.stage) ? j.stage : null;
    return { reply: typeof j.reply === "string" ? j.reply.trim() : "", fields, handoff: j.handoff === true, stage };
  } catch {
    return { ...empty, reply: raw.trim() };
  }
}

const STAGE_RANK: Record<string, number> = { new: 0, engaged: 1, qualified: 2, site_visit: 3, won: 4, lost: 4 };
/** The bot only ever moves a lead forward, never backward or out of won/lost. */
export const advanceStage = (current: string, next: string | null): string => (next && (STAGE_RANK[next] ?? 0) > (STAGE_RANK[current] ?? 0) && (STAGE_RANK[current] ?? 0) < 4 ? next : current);
