import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Instagram comment/DM automation: pure rules. No I/O here, so the API, the
 * webhook and the tests share one definition of "what matches" and "what is sent".
 * Meta facts used here were checked against developers.facebook.com on
 * 2026-11-21 (see DECISIONS.md, "Instagram automation").
 */

/** Meta: a private reply must be sent within 7 days of the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Meta: Instagram DM text must be under 1,000 characters; button template text up to 640. */
export const MAX_DM_TEXT = 1000;
export const MAX_BUTTON_TEXT = 640;
export const MAX_BUTTON_TITLE = 20;
export const MAX_PUBLIC_REPLY = 2200;

/* -------------------------------- matching --------------------------------- */

/** Lower-case, strip accents, collapse whitespace. Emoji and non-Latin scripts are kept. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when `keyword` appears in `text` as a whole word or phrase: "link" matches
 * "send me the LINK!" but not "linked". Keywords that are only symbols or emoji
 * (no letters/digits) match as plain substrings.
 */
export function containsKeyword(text: string, keyword: string): boolean {
  const t = normalize(text);
  const k = normalize(keyword);
  if (!k) return false;
  if (!/[\p{L}\p{N}]/u.test(k)) return t.includes(k);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(k)}($|[^\\p{L}\\p{N}_])`, "u");
  return re.test(t);
}

/** Text equals a keyword, ignoring case, accents, surrounding punctuation and spaces. */
export function equalsKeyword(text: string, keyword: string): boolean {
  const strip = (s: string) => normalize(s).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const k = strip(keyword);
  return k.length > 0 && strip(text) === k;
}

export type MatchMode = "keywords" | "exact" | "any";
export type Trigger = "comment" | "dm";

export interface RuleLike {
  id: string;
  active: boolean;
  trigger: string;
  matchMode: string;
  keywords: string[];
  mediaScope: string;
  mediaIds: string[];
  priority: number;
  createdAt: Date;
}

export function ruleMatches(rule: RuleLike, input: { trigger: Trigger; text: string; mediaId: string | null }): boolean {
  if (!rule.active || rule.trigger !== input.trigger) return false;
  if (input.trigger === "comment" && rule.mediaScope === "selected") {
    if (!input.mediaId || !rule.mediaIds.includes(input.mediaId)) return false;
  }
  switch (rule.matchMode as MatchMode) {
    case "any":
      return input.text.trim().length > 0;
    case "exact":
      return rule.keywords.some((k) => equalsKeyword(input.text, k));
    default:
      return rule.keywords.some((k) => containsKeyword(input.text, k));
  }
}

/**
 * The rule that handles this comment/message: lowest priority number first,
 * then rules scoped to specific posts before "all posts" rules, then oldest.
 */
export function pickRule<T extends RuleLike>(rules: T[], input: { trigger: Trigger; text: string; mediaId: string | null }): T | null {
  const hits = rules.filter((r) => ruleMatches(r, input));
  hits.sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(b.mediaScope === "selected") - Number(a.mediaScope === "selected") ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return hits[0] ?? null;
}

/* ------------------------------- reply content ------------------------------ */

/** Deterministic pick per comment, so a retried job sends the same variant it chose first. */
export function pickVariant(variants: string[], seed: string): string | null {
  const list = variants.map((v) => v.trim()).filter(Boolean);
  if (!list.length) return null;
  const n = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return list[n % list.length]!;
}

/** Fills {username} / {first_name}-style placeholders. Unknown placeholders are left as typed. */
export function renderTemplate(template: string, vars: { username?: string | null }): string {
  return template
    .replace(/\{\s*username\s*\}/gi, vars.username ? `@${vars.username.replace(/^@/, "")}` : "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

export interface DmOptionLike {
  id: string;
  title: string;
  kind: string;
  url: string;
  text: string | null;
}

export interface DmContent {
  text: string;
  buttonTitle?: string | null;
  buttonUrl?: string | null;
  /** Tap-to-select choices (max 3). Sent as postback buttons that carry `opt:<ruleId>:<optionId>`. */
  options?: { id: string; title: string }[];
  ruleId?: string;
}

/** DM text followed by the link, e.g. "Here you go\n\nGuide: https://...". */
export function textWithLink(c: DmContent): string {
  if (!c.buttonUrl || c.text.includes(c.buttonUrl)) return c.text;
  return `${c.text}\n\n${c.buttonTitle ? `${c.buttonTitle}: ` : ""}${c.buttonUrl}`;
}

export const optionPayload = (ruleId: string, optionId: string) => `opt:${ruleId}:${optionId}`;

export function parseOptionPayload(payload: string | null | undefined): { ruleId: string; optionId: string } | null {
  const m = /^opt:([^:]+):([^:]+)$/.exec(payload ?? "");
  return m ? { ruleId: m[1]!, optionId: m[2]! } : null;
}

/** Options as stored on a rule (JSON column), tolerant of anything malformed. */
export function readOptions(raw: unknown): DmOptionLike[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.title !== "string" || typeof r.url !== "string") return [];
    return [{ id: r.id, title: r.title, kind: typeof r.kind === "string" ? r.kind : "link", url: r.url, text: typeof r.text === "string" ? r.text : null }];
  });
}

/** Instagram message body: option buttons, or a link button, otherwise plain text. */
export function buildDmMessage(c: DmContent): Record<string, unknown> {
  if (c.options?.length && c.ruleId) {
    const ruleId = c.ruleId;
    const optionButtons = c.options.slice(0, 3).map((o) => ({ type: "postback", title: o.title.slice(0, MAX_BUTTON_TITLE), payload: optionPayload(ruleId, o.id) }));
    // Instagram allows 3 buttons per message, all taken by the options: the link goes in the text (links in DM text are tappable).
    const text = c.buttonUrl ? textWithLink(c) : c.text;
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text.slice(0, MAX_BUTTON_TEXT),
          buttons: c.options.slice(0, 3).map((o) => ({ type: "postback", title: o.title.slice(0, MAX_BUTTON_TITLE), payload: optionPayload(ruleId, o.id) })),
        },
      },
    };
  }
  if (c.buttonTitle && c.buttonUrl) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: c.text.slice(0, MAX_BUTTON_TEXT),
          buttons: [{ type: "web_url", url: c.buttonUrl, title: c.buttonTitle.slice(0, MAX_BUTTON_TITLE) }],
        },
      },
    };
  }
  return { text: c.text.slice(0, MAX_DM_TEXT) };
}

/** Plain-text fallback when the button template is refused: the link goes in the text. */
export function dmTextWithLink(c: DmContent): Record<string, unknown> {
  const text = c.buttonUrl && !c.text.includes(c.buttonUrl) ? `${c.text}\n\n${c.buttonTitle ? `${c.buttonTitle}: ` : ""}${c.buttonUrl}` : c.text;
  return { text: text.slice(0, MAX_DM_TEXT) };
}

/** Plain-text fallback for an option message: the choices are listed so the person can type one. */
export function dmTextWithOptions(c: DmContent): Record<string, unknown> {
  const list = (c.options ?? []).map((o) => `- ${o.title}`).join("\n");
  const link = c.buttonUrl ? `\n\n${c.buttonTitle ? `${c.buttonTitle}: ` : ""}${c.buttonUrl}` : "";
  return { text: `${c.text}\n\n${list}${link}`.slice(0, MAX_DM_TEXT) };
}

/** What is sent when the person taps an option: the file itself, or a text with an open button. */
export function buildOptionReply(o: DmOptionLike): { message: Record<string, unknown>; fallbackText: string } {
  const text = (o.text?.trim() || o.title).slice(0, MAX_BUTTON_TEXT);
  const fallbackText = `${o.text?.trim() || o.title}\n${o.url}`.slice(0, MAX_DM_TEXT);
  if (o.kind === "image" || o.kind === "video") {
    return { message: { attachment: { type: o.kind, payload: { url: o.url } } }, fallbackText };
  }
  return {
    message: {
      attachment: {
        type: "template",
        payload: { template_type: "button", text, buttons: [{ type: "web_url", url: o.url, title: `Open ${o.title}`.slice(0, MAX_BUTTON_TITLE) }] },
      },
    },
    fallbackText,
  };
}

/** Problems with a rule as configured (shown to the owner). Empty = valid. */
export function ruleProblems(r: {
  trigger: string;
  matchMode: string;
  keywords: string[];
  mediaScope: string;
  mediaIds: string[];
  publicReplies: string[];
  dmText: string | null;
  dmButtonTitle: string | null;
  dmButtonUrl: string | null;
  dmOptions?: { title: string; kind: string; url: string }[];
}): string[] {
  const p: string[] = [];
  const options = r.dmOptions ?? [];
  if (options.length) {
    if (!r.dmText?.trim()) p.push("Write the DM text that comes with the options");
    if (r.dmButtonUrl && (r.dmText?.length ?? 0) + r.dmButtonUrl.length + (r.dmButtonTitle?.length ?? 0) + 4 > MAX_BUTTON_TEXT) {
      p.push("With options, the DM text plus the link must fit in 640 characters");
    }
    if (options.length > 3) p.push("Instagram allows at most 3 options per message");
    if (new Set(options.map((o) => o.title.trim().toLowerCase())).size !== options.length) p.push("Option titles must be different");
    for (const o of options) {
      try {
        if (new URL(o.url).protocol !== "https:") p.push(`Option "${o.title}": URL must start with https://`);
      } catch {
        p.push(`Option "${o.title}": URL is not valid`);
      }
    }
  }
  if (r.matchMode !== "any" && !r.keywords.some((k) => k.trim())) p.push("Add at least one keyword (or match every comment)");
  if (r.trigger === "comment" && r.mediaScope === "selected" && r.mediaIds.length === 0) p.push("Pick at least one post, or apply the rule to all posts");
  const hasPublic = r.trigger === "comment" && r.publicReplies.some((x) => x.trim());
  const hasDm = !!r.dmText?.trim();
  if (!hasPublic && !hasDm) p.push(r.trigger === "dm" ? "Write the DM reply" : "Write a public reply, a DM, or both");
  if (r.trigger === "dm" && r.publicReplies.some((x) => x.trim())) p.push("DM rules can't post public replies");
  if (r.dmText && !(r.dmOptions?.length && r.dmButtonUrl) && r.dmText.length > (r.dmButtonUrl || r.dmOptions?.length ? MAX_BUTTON_TEXT : MAX_DM_TEXT)) {
    p.push(`DM text is too long (max ${r.dmButtonUrl ? MAX_BUTTON_TEXT : MAX_DM_TEXT} characters${r.dmButtonUrl ? " with a button" : ""})`);
  }
  if (!!r.dmButtonTitle !== !!r.dmButtonUrl) p.push("A link button needs both a title and a URL");
  if (r.dmButtonTitle && r.dmButtonTitle.length > MAX_BUTTON_TITLE) p.push(`Button title max ${MAX_BUTTON_TITLE} characters`);
  if (r.dmButtonUrl) {
    try {
      if (new URL(r.dmButtonUrl).protocol !== "https:") p.push("Button URL must start with https://");
    } catch {
      p.push("Button URL is not a valid URL");
    }
  }
  for (const v of r.publicReplies) if (v.length > MAX_PUBLIC_REPLY) p.push(`A public reply is longer than ${MAX_PUBLIC_REPLY} characters`);
  return p;
}

/* --------------------------------- webhook ---------------------------------- */

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(raw body, app secret). */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want, "hex"), Buffer.from(got, "hex"));
}

export interface CommentEvent {
  kind: "comment";
  /** Instagram business account id the comment belongs to (entry.id). */
  igAccountId: string;
  commentId: string;
  parentId: string | null;
  mediaId: string | null;
  mediaProductType: string | null;
  live: boolean;
  fromId: string | null;
  fromUsername: string | null;
  text: string;
  occurredAt: Date;
}

export interface MessageEvent {
  kind: "message";
  igAccountId: string;
  mid: string;
  senderId: string;
  text: string;
  occurredAt: Date;
}

/** The person tapped a postback button (one of the options we sent). */
export interface PostbackEvent {
  kind: "postback";
  igAccountId: string;
  mid: string;
  senderId: string;
  payload: string;
  title: string;
  occurredAt: Date;
}

export type InboundEvent = CommentEvent | MessageEvent | PostbackEvent;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/**
 * Normalises a webhook delivery into comment and message events. Unknown fields
 * and echoes of our own messages are dropped. Accepts both `object: "instagram"`
 * and Page-object deliveries that carry Instagram messaging.
 */
export function parseWebhook(body: unknown): InboundEvent[] {
  const b = body as { object?: string; entry?: unknown[] } | null;
  if (!b || !Array.isArray(b.entry)) return [];
  const out: InboundEvent[] = [];
  for (const e of b.entry as Record<string, unknown>[]) {
    const igAccountId = str(e.id);
    if (!igAccountId) continue;
    const entryTime = typeof e.time === "number" ? e.time : null;
    for (const ch of (Array.isArray(e.changes) ? e.changes : []) as { field?: string; value?: Record<string, unknown> }[]) {
      if ((ch.field !== "comments" && ch.field !== "live_comments") || !ch.value) continue;
      const v = ch.value;
      // Meta documents `comment_id`; older payloads used `id`.
      const commentId = str(v.comment_id) ?? str(v.id);
      if (!commentId) continue;
      const from = (v.from ?? {}) as Record<string, unknown>;
      const media = (v.media ?? {}) as Record<string, unknown>;
      out.push({
        kind: "comment",
        igAccountId,
        commentId,
        parentId: str(v.parent_id),
        mediaId: str(media.id),
        mediaProductType: str(media.media_product_type),
        live: ch.field === "live_comments",
        fromId: str(from.id),
        fromUsername: str(from.username),
        text: typeof v.text === "string" ? v.text : "",
        occurredAt: entryTime ? new Date(entryTime > 1e12 ? entryTime : entryTime * 1000) : new Date(),
      });
    }
    for (const m of (Array.isArray(e.messaging) ? e.messaging : []) as Record<string, unknown>[]) {
      const pb = (m.postback ?? null) as Record<string, unknown> | null;
      if (pb) {
        const senderId = str((m.sender as Record<string, unknown> | undefined)?.id);
        const payload = str(pb.payload);
        if (!senderId || !payload || senderId === igAccountId) continue;
        const ts = typeof m.timestamp === "number" ? m.timestamp : entryTime;
        const at = ts ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date();
        out.push({
          kind: "postback",
          igAccountId,
          // Some deliveries have no mid: sender + payload + time still identifies a tap.
          mid: str(pb.mid) ?? `pb:${senderId}:${payload}:${at.getTime()}`,
          senderId,
          payload,
          title: str(pb.title) ?? "",
          occurredAt: at,
        });
        continue;
      }
      const msg = (m.message ?? null) as Record<string, unknown> | null;
      if (!msg || msg.is_echo === true || msg.is_deleted === true || msg.is_unsupported === true) continue;
      const mid = str(msg.mid);
      const senderId = str((m.sender as Record<string, unknown> | undefined)?.id);
      if (!mid || !senderId || senderId === igAccountId) continue;
      const ts = typeof m.timestamp === "number" ? m.timestamp : entryTime;
      out.push({
        kind: "message",
        igAccountId,
        mid,
        senderId,
        text: typeof msg.text === "string" ? msg.text : "",
        occurredAt: ts ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(),
      });
    }
  }
  return out;
}

/* ------------------------------ processing plan ----------------------------- */

export type SkipReason =
  | "own_account"
  | "empty_text"
  | "no_rule"
  | "already_replied_to_user"
  | "too_old_for_private_reply"
  | "account_not_active";

/** What to do for one comment once a rule matched. Pure, so the job and the "test" endpoint agree. */
export function planCommentActions(input: {
  ev: Pick<CommentEvent, "parentId" | "live" | "occurredAt">;
  rule: { publicReplies: string[]; dmText: string | null };
  now?: Date;
}): { publicReply: boolean; publicReplyNote: string | null; dm: boolean; dmNote: string | null } {
  const now = input.now ?? new Date();
  const wantsPublic = input.rule.publicReplies.some((r) => r.trim());
  const wantsDm = !!input.rule.dmText?.trim();
  let publicReplyNote: string | null = null;
  let dmNote: string | null = null;
  let publicReply = wantsPublic;
  let dm = wantsDm;
  if (wantsPublic && input.ev.live) {
    publicReply = false;
    publicReplyNote = "Instagram doesn't allow replies to live comments";
  } else if (wantsPublic && input.ev.parentId) {
    publicReply = false;
    publicReplyNote = "Instagram only allows replies to top-level comments";
  }
  if (wantsDm && now.getTime() - input.ev.occurredAt.getTime() > PRIVATE_REPLY_WINDOW_MS) {
    dm = false;
    dmNote = "Comment is older than 7 days: Instagram no longer allows a private reply";
  }
  return { publicReply, publicReplyNote, dm, dmNote };
}

/* ---------------------------------- errors ---------------------------------- */

export type GraphErrorKind = "rate_limit" | "auth" | "permission" | "window" | "invalid" | "retryable" | "unsupported_path";

/** Classifies a Graph API error body into what the job should do next. */
export function classifyGraphError(status: number, body: unknown): { kind: GraphErrorKind; code: number | null; subcode: number | null; message: string } {
  const e = ((body as { error?: Record<string, unknown> })?.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
  const code = typeof e.code === "number" ? e.code : null;
  const subcode = typeof e.error_subcode === "number" ? e.error_subcode : null;
  const message = String(e.message ?? `Meta request failed (${status})`).slice(0, 300);
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002 || code === 80006 || status === 429) {
    return { kind: "rate_limit", code, subcode, message };
  }
  if (code === 190 || status === 401) return { kind: "auth", code, subcode, message };
  // Outside the messaging window / private reply already sent / user can't be messaged (checked before
  // permissions: Meta reuses code 10 for "outside the allowed window" with a messaging subcode).
  if (code === 551 || subcode === 2018278 || subcode === 2534022 || subcode === 2018001 || subcode === 2018108 || subcode === 2018034) {
    return { kind: "window", code, subcode, message };
  }
  if (code === 10 || code === 3 || (code !== null && code >= 200 && code < 300)) return { kind: "permission", code, subcode, message };
  if (code === 100 && (subcode === 33 || /nonexisting field|unknown path|does not exist|cannot be loaded/i.test(message))) {
    return { kind: "unsupported_path", code, subcode, message };
  }
  if (status >= 500 || code === 1 || code === 2) return { kind: "retryable", code, subcode, message };
  return { kind: "invalid", code, subcode, message };
}

/* -------------------------------- permissions ------------------------------- */

/** Meta permissions this feature needs with Facebook Login (fields + private replies + send API pages). */
export const AUTOMATION_PERMISSIONS = [
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_show_list",
] as const;

export function missingPermissions(granted: string[]): string[] {
  const g = new Set(granted);
  return AUTOMATION_PERMISSIONS.filter((p) => !g.has(p));
}
