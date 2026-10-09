import type { Ask, NotificationInput } from "../generated/HyperfeedClient";
import { Deferred, evaluate, type Scope, type Value } from "./expr";

/**
 * A lens: how one app version's events become feed items.
 *
 * Your agent writes one per app version, from the app's ABI, and you approve
 * it. From then on the collector (the app in your browser, and mero-bot) runs
 * it on every event with plain code: no model call per event, and the same
 * result on every device.
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "events": {
 *     "MessageSent": {
 *       "type": "message",
 *       "read": [
 *         { "as": "pos",  "call": "message_position",  "args": { "message_id": "=event.message_id" } },
 *         { "as": "page", "call": "get_messages_from", "args": { "start": "=pos", "limit": 1 } },
 *         { "as": "info", "call": "get_info", "args": {} }
 *       ],
 *       "let":     { "item": "=page.messages[0]" },
 *       "show_if": "=!mine(item.sender) && (info.context_type == 'Dm' || has(item.mentions, me))",
 *       "fields":  { "from": "=item.sender", "text": "=plain(item.text)", "is_dm": "=info.context_type == 'Dm'" },
 *       "reply":   { "method": "send_message", "args": { "message": "=answer", "timestamp": "=now_s()" } }
 *     },
 *     "TextChanged": "ignore"
 *   }
 * }
 * ```
 *
 * A string starting with `=` is an expression (see `expr.ts`); anything else
 * is taken as it is. `reply` args may read `answer` and `now_s()`; they are
 * filled in when you answer, everything else when the event arrives.
 */

export interface LensSpec {
  version: 1;
  events: Record<string, EventLens | "ignore">;
}

export interface ReadStep {
  as: string;
  call: string;
  args: Record<string, Value>;
}

export interface EventLens {
  type: ItemType;
  read?: ReadStep[];
  /** Names for values used more than once, evaluated in order after the reads. */
  let?: Record<string, string>;
  /** Record it only when this holds. Default: always. */
  show_if?: string;
  fields: Record<string, Value>;
  title?: string;
  needs_you?: string | boolean;
  ask?: { kind: "reply" | "choose" | "confirm"; prompt?: string; options?: Value };
  reply?: { method: string; args: Record<string, Value> };
}

// ── the item types ────────────────────────────────────────────────────────────

export type ItemType = "message" | "assignment" | "poll" | "invite" | "turn" | "request" | "change" | "status" | "other";

interface TypeInfo {
  /** The fields a card of this type shows; a lens may set no others. */
  fields: Record<string, "text" | "identity" | "bool" | "list" | "time">;
  /** The field the row's body is, if any. */
  body?: string;
  title: (f: Fields) => string;
  needsYou: boolean;
  /** How it is answered when the lens gives a reply call and no `ask`. */
  ask: (f: Fields) => Omit<Ask, "draft">;
}

type Fields = Record<string, Value>;
const s = (v: Value) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

export const ITEM_TYPES: Record<ItemType, TypeInfo> = {
  message: {
    fields: { from: "identity", text: "text", where: "text", is_dm: "bool" },
    body: "text",
    title: (f) => (f.is_dm ? "Sent you a message" : "Mentioned you"),
    needsYou: true,
    ask: (f) => ({ kind: "reply", prompt: f.where ? `Reply in ${s(f.where)}` : "Reply", options: [] }),
  },
  assignment: {
    fields: { from: "identity", what: "text", detail: "text", due: "time", where: "text" },
    body: "detail",
    title: (f) => `Assigned you ${s(f.what) || "something"}`,
    needsYou: true,
    ask: () => ({ kind: "choose", prompt: "Take it?", options: ["Take it", "Hand it back"] }),
  },
  poll: {
    fields: { from: "identity", question: "text", options: "list", closes_at: "time", where: "text" },
    title: (f) => s(f.question) || "A new poll",
    needsYou: true,
    ask: (f) => ({ kind: "choose", prompt: "Your vote", options: Array.isArray(f.options) ? f.options.map(s) : [] }),
  },
  invite: {
    fields: { from: "identity", what: "text", when: "time", where: "text" },
    title: (f) => `Invited you to ${s(f.what) || "something"}`,
    needsYou: true,
    ask: () => ({ kind: "choose", prompt: "Going?", options: ["Accept", "Decline"] }),
  },
  turn: {
    fields: { from: "identity", game: "text", last_move: "text", state: "text", where: "text" },
    body: "last_move",
    title: (f) => `Your turn${f.game ? ` in ${s(f.game)}` : ""}`,
    needsYou: true,
    ask: () => ({ kind: "confirm", prompt: "Open the game", options: [] }),
  },
  request: {
    fields: { from: "identity", asks_for: "text", detail: "text", where: "text" },
    body: "detail",
    title: (f) => `Asks you to ${s(f.asks_for) || "do something"}`,
    needsYou: true,
    ask: () => ({ kind: "choose", prompt: "Your answer", options: ["Approve", "Decline"] }),
  },
  change: {
    fields: { from: "identity", what: "text", summary: "text", where: "text" },
    body: "summary",
    title: (f) => `Changed ${s(f.what) || "something"}`,
    needsYou: false,
    ask: () => ({ kind: "confirm", prompt: "Acknowledge", options: [] }),
  },
  status: {
    fields: { what: "text", state: "text", where: "text" },
    body: "state",
    title: (f) => s(f.what) || "Something changed",
    needsYou: false,
    ask: () => ({ kind: "confirm", prompt: "Acknowledge", options: [] }),
  },
  other: {
    fields: { from: "identity", title: "text", body: "text", where: "text" },
    body: "body",
    title: (f) => s(f.title) || "Something happened",
    needsYou: false,
    ask: () => ({ kind: "confirm", prompt: "Acknowledge", options: [] }),
  },
};

export const NO_ASK: Ask = { kind: "", prompt: "", options: [], draft: "" };

/** One text field's share of a typed row (the row's body keeps up to 2 kB). */
const FIELD_TEXT = 1_000;

// ── running a lens ────────────────────────────────────────────────────────────

/** What a lens may ask of the context an event came from. */
export interface LensHost {
  /** Call one of the app's read-only methods in that context. */
  call<T>(method: string, args: Record<string, unknown>): Promise<T>;
  /** Your identities, every form an app may write them in. */
  me(): Promise<Set<string>>;
  /** A person's display name, or "" when nobody named them. */
  name(identity: string): Promise<string>;
}

export interface SourceInfo {
  contextId: string;
  appKey: string;
  label: string;
}

/** The parts of a notification a lens decides. */
export type LensReading = Pick<
  NotificationInput,
  "title" | "body" | "from" | "source_label" | "needs_you" | "ask" | "item_type" | "fields" | "reply_call"
>;

/** `=expr` is an expression; anything else is a literal. Objects and lists are walked. */
export function resolve(value: Value, scope: Scope): Value {
  if (typeof value === "string") return value.startsWith("=") ? evaluate(value.slice(1), scope) : value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, scope));
  if (value && typeof value === "object") {
    const out: Record<string, Value> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v, scope);
    return out;
  }
  return value;
}

/**
 * Resolves what can be resolved now and keeps the `=expr` of anything that
 * reads a value known only later (`answer`, the time you answer).
 */
function resolveLater(value: Value, scope: Scope): Value {
  if (typeof value === "string" && value.startsWith("=")) {
    try {
      return evaluate(value.slice(1), scope);
    } catch (e) {
      if (e instanceof Deferred) return value;
      throw e;
    }
  }
  if (Array.isArray(value)) return value.map((v) => resolveLater(v, scope));
  if (value && typeof value === "object") {
    const out: Record<string, Value> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveLater(v, scope);
    return out;
  }
  return value;
}

const truthy = (v: Value) => !(v === null || v === undefined || v === false || v === 0 || v === "");

/** What a lens did with one event: why, for a preview and a dry run. */
export type Outcome =
  | { kind: "recorded"; reading: LensReading }
  | { kind: "skipped"; why: string }
  | { kind: "error"; why: string };

/** Runs one event through a lens. Never throws: a bad read drops the event. */
export async function runLens(
  spec: LensSpec,
  kind: string,
  payload: Value,
  source: SourceInfo,
  host: LensHost,
): Promise<Outcome> {
  const lens = spec.events?.[kind];
  if (!lens) return { kind: "skipped", why: `the lens says nothing about ${kind}` };
  if (lens === "ignore") return { kind: "skipped", why: `${kind} is ignored` };
  try {
    const me = await host.me();
    const vars: Record<string, Value> = { event: payload, context: { id: source.contextId, label: source.label } };
    const scope: Scope = { vars, me, deferred: new Set(["answer", "now_s", "now_ms"]) };
    for (const step of lens.read ?? []) {
      vars[step.as] = await host.call(step.call, resolve(step.args, scope) as Record<string, unknown>);
    }
    for (const [name, expr] of Object.entries(lens.let ?? {})) vars[name] = resolve(expr, scope);
    if (lens.show_if !== undefined && !truthy(resolve(lens.show_if, scope))) {
      return { kind: "skipped", why: "not for you" };
    }
    const type = ITEM_TYPES[lens.type];
    if (!type) return { kind: "error", why: `unknown type ${lens.type}` };
    const fields: Fields = {};
    for (const [k, v] of Object.entries(lens.fields ?? {})) fields[k] = resolve(v, scope);
    // Identities become names a person reads; the raw id stays beside it.
    for (const [k, t] of Object.entries(type.fields)) {
      if (t === "identity" && typeof fields[k] === "string" && fields[k]) {
        const id = fields[k] as string;
        fields[`${k}_id`] = id;
        fields[k] = (await host.name(id)) || shortId(id);
      }
    }
    // A card shows a short text; the whole row must fit the contract's 4 kB.
    for (const [k, v] of Object.entries(fields)) if (typeof v === "string") fields[k] = clip(v, FIELD_TEXT);
    const reply = lens.reply
      ? { method: lens.reply.method, args: resolveLater(lens.reply.args, scope) }
      : undefined;
    const ask: Ask = lens.ask
      ? {
          kind: lens.ask.kind,
          prompt: s(resolve(lens.ask.prompt ?? "", scope)),
          options: asStrings(resolve(lens.ask.options ?? [], scope)),
          draft: "",
        }
      : reply
        ? { ...type.ask(fields), draft: "" }
        : NO_ASK;
    const needsYou =
      lens.needs_you === undefined ? type.needsYou : truthy(typeof lens.needs_you === "string" ? resolve(lens.needs_you, scope) : lens.needs_you);
    return {
      kind: "recorded",
      reading: {
        item_type: lens.type,
        title: clip(s(lens.title ? resolve(lens.title, scope) : type.title(fields)) || kind, 200),
        body: clip(type.body ? s(fields[type.body]) : "", 2000),
        from: clip(s(fields.from), 120),
        source_label: clip(s(fields.where) || source.label, 120),
        needs_you: needsYou,
        ask,
        fields: clip(JSON.stringify(fields), 4000, true),
        reply_call: reply ? JSON.stringify(reply) : "",
      },
    };
  } catch (e) {
    return { kind: "error", why: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The call that answers a typed notification, with your answer in it: what the
 * feed sends to the source app when you reply, vote or accept.
 */
export function fillReplyCall(replyCall: string, answer: string, now = Date.now()): { method: string; args: Record<string, unknown> } {
  const call = JSON.parse(replyCall) as { method: string; args: Record<string, Value> };
  const scope: Scope = { vars: { answer }, me: new Set(), now: () => now };
  return { method: call.method, args: resolve(call.args, scope) as Record<string, unknown> };
}

function asStrings(v: Value): string[] {
  return Array.isArray(v) ? v.map(s).filter(Boolean).slice(0, 8).map((o) => clip(o, 120)) : [];
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/**
 * `text` cut to at most `max` UTF-8 bytes, as the contract counts them. JSON is
 * not cut (a cut object would not parse): too long is an error instead.
 */
function clip(text: string, max: number, json = false): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  if (json) throw new Error(`fields are longer than ${max} bytes`);
  let out = "";
  let used = 0;
  for (const ch of text) {
    const n = encoder.encode(ch).length;
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

export function parseLens(spec: string): LensSpec {
  const parsed = JSON.parse(spec) as LensSpec;
  if (!parsed || typeof parsed !== "object" || typeof parsed.events !== "object") {
    throw new Error("a lens is {\"version\": 1, \"events\": {…}}");
  }
  return parsed;
}
