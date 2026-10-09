import type { Ask, NotificationInput } from "./generated/HyperfeedClient";

/**
 * Turning another app's live events into Hyperfeed notifications.
 *
 * Every app on your node emits events as its state changes, and your node
 * streams them to any client subscribed to that context. An event is a `kind`
 * (`MessageSent`, `TextChanged`, …) plus JSON bytes the app chose; core does
 * not say who caused it or whether it concerns you. Nearly all of them are
 * bookkeeping (a keystroke, a cursor, a reaction), and your own node emits
 * them for your own edits too. So nothing is recorded by default: an event
 * becomes a notification only through a READER written for that app and kind,
 * which reads what the event points at from the app itself, drops what you did
 * yourself, and keeps only what concerns you.
 *
 * Readers so far: Chat (a DM, a mention of you or of everyone, your role
 * changing). Another app gets into the feed by adding a reader here.
 *
 * The dedupe key is `<context>:<previous root>><new root>:<index>`: the state
 * TRANSITION, not just where it ended. Every device watching a context sees the
 * same sequence of roots, so the same change keys the same way everywhere and
 * the contract records it once. The new root alone is not enough: core derives
 * it from the state's contents, so a value set A, then B, then A again ends on
 * a root it had before, and the third change would read as a repeat of the
 * first. The contract also treats a key seen again after a few seconds as a new
 * occurrence, which covers the rest (A, B, A, B, A …).
 *
 * A device's first event for a context has no previous root, so the key
 * starts `<context>:>`; a device that connects mid-stream may record that one
 * event a second time. A duplicate is the cheaper failure: a missed event is
 * gone for good.
 *
 * ⚠️ mero-bot carries the same readers and keys (`src/hyperfeed/collect.ts`).
 * Change both or neither.
 */

/** The `data` of a `StateMutation` context event. */
export interface StateMutation {
  newRoot?: string;
  events?: { kind?: string; data?: number[] | string | null }[];
}

export interface SourceContext {
  contextId: string;
  appKey: string;
  label: string;
}

/** What a reader may ask of the context an event came from. */
export interface SourceReader {
  /** Call one of the app's methods in that context. */
  call<T>(method: string, args: Record<string, unknown>): Promise<T>;
  /**
   * Who "you" are to the app: your account id (what apps stamp on what you
   * do, via `env::account_id()`) and this device's key, each hex and base58.
   */
  me(): Promise<Set<string>>;
}

export interface Reading {
  title: string;
  body: string;
  from: string;
  /** Where in the app, as you would say it: `#launch`, `DM`. Defaults to the context's label. */
  where?: string;
  needsYou: boolean;
  ask: Ask;
}

/** Reads one event; `null` when it is not news for you. */
type Reader = (payload: unknown, source: SourceReader) => Promise<Reading | null>;

const NO_ASK: Ask = { kind: "", prompt: "", options: [], draft: "" };

// ── Chat (apps/mero-chat) ─────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  mentions: string[];
  mentions_usernames: string[];
  deleted?: boolean | null;
}

interface ChatInfo {
  name: string;
  context_type: string;
}

interface ChatProfile {
  identity: string;
  username: string;
}

async function chatPlace(source: SourceReader): Promise<{ dm: boolean; where: string; names: Map<string, string> }> {
  const [info, profiles] = await Promise.all([
    source.call<ChatInfo>("get_info", {}),
    source.call<ChatProfile[]>("get_profiles", {}),
  ]);
  const dm = info.context_type === "Dm";
  return {
    dm,
    where: dm ? "DM" : `#${info.name}`,
    names: new Map(profiles.map((p) => [p.identity, p.username])),
  };
}

const CHAT: Record<string, Reader> = {
  // The event names the message; the message says who sent it and whom it
  // mentions. A DM or a mention needs you; the rest of a channel does not.
  MessageSent: async (payload, source) => {
    const id = field(payload, "message_id");
    if (!id) return null;
    const position = await source.call<number | null>("message_position", { message_id: id });
    if (position == null) return null;
    const page = await source.call<{ messages: ChatMessage[] }>("get_messages_from", { start: position, limit: 1 });
    const m = page.messages[0];
    if (!m || m.id !== id || m.deleted) return null;
    const me = await source.me();
    if (me.has(m.sender)) return null;
    const everyone = m.mentions_usernames.some((u) => u === "everyone" || u === "here");
    const mentioned = m.mentions.some((u) => me.has(u));
    const { dm, where, names } = await chatPlace(source);
    if (!dm && !mentioned && !everyone) return null;
    const from = names.get(m.sender) || shortId(m.sender);
    return {
      title: dm ? "Sent you a message" : mentioned ? "Mentioned you" : `Mentioned everyone in ${where}`,
      body: plainText(m.text),
      from,
      where,
      needsYou: true,
      ask: { kind: "reply", prompt: clip(dm ? `Reply to ${from}` : `Reply in ${where}`, 200), options: [], draft: "" },
    };
  },
  // Someone changed YOUR role; anyone else's is not your news.
  RoleUpdated: async (payload, source) => {
    const target = typeof payload === "string" ? payload : "";
    if (!target || !(await source.me()).has(target)) return null;
    const [role, { dm, where }] = await Promise.all([
      source.call<string>("get_member_role", { identity: target }),
      chatPlace(source),
    ]);
    return {
      title: "Your role changed",
      body: `You are now ${String(role)} in ${dm ? "this DM" : where}.`,
      from: "",
      where,
      needsYou: false,
      ask: NO_ASK,
    };
  },
};

/** Readers by app key, then event kind. Kinds collide across apps, so the app comes first. */
export const READERS: Record<string, Record<string, Reader>> = {
  chat: CHAT,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function field(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") return "";
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** `text` cut to at most `max` UTF-8 bytes on a character boundary: the contract counts bytes. */
export function clip(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
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

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** A message as you would read it: the editor's markup dropped. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Hex → base58, the encoding an app's `UserId` takes on the wire. "" for anything but hex. */
export function hexToBase58(hex: string): string {
  const clean = hex.replace(/^0x/, "");
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return "";
  let n = BigInt(`0x${clean}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  // Each leading zero byte is a leading "1".
  for (let i = 0; i < clean.length && clean.slice(i, i + 2) === "00"; i += 2) out = `1${out}`;
  return out;
}

/** Every form an app may write your identity in, from the node's account and device ids. */
export function identitiesOf(ids: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    out.add(id);
    const b58 = hexToBase58(id);
    if (b58) out.add(b58);
  }
  return out;
}

/** `IssueAssigned` → `Issue assigned`. */
export function humanise(kind: string): string {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The JSON an event carries (an object, a string, …), or `null` when it is not JSON. */
export function decodePayload(data: number[] | string | null | undefined): unknown {
  if (data == null) return null;
  try {
    const raw = typeof data === "string" ? data : new TextDecoder().decode(Uint8Array.from(data));
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * The notifications in one state change: one per event a reader says is news
 * for you. A reader that fails (the app is older, the call is refused) drops
 * its event; the rest of the change is still read.
 */
export async function toNotifications(
  source: SourceContext,
  mutation: StateMutation,
  /** The root this client last saw for the context, or "" for its first event. */
  previousRoot: string,
  reader: SourceReader,
): Promise<NotificationInput[]> {
  const root = mutation.newRoot ?? "";
  if (!root) return []; // no stable key, and recording it twice is worse than not at all
  const readers = READERS[source.appKey];
  if (!readers) return [];
  const read = await Promise.all(
    (mutation.events ?? []).map(async (event, index) => {
      const kind = event.kind ?? "";
      const readEvent = readers[kind];
      if (!readEvent) return null;
      try {
        const reading = await readEvent(decodePayload(event.data), reader);
        return reading ? { kind, index, reading } : null;
      } catch (e) {
        console.warn(`[hyperfeed] could not read ${source.appKey} ${kind}`, e);
        return null;
      }
    }),
  );
  return read
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(({ kind, index, reading }) => ({
      // The index is the event's place in the change, so a skipped event never shifts a key.
      key: clip(`${source.contextId}:${previousRoot.slice(0, 16)}>${root}:${index}`, 200),
      app: source.appKey,
      source_context: source.contextId,
      source_label: clip(reading.where || source.label, 120),
      from: clip(reading.from, 120),
      title: clip(reading.title || humanise(kind), 200),
      body: clip(reading.body, 2000),
      event: clip(kind, 120),
      needs_you: reading.needsYou,
      // Every notification starts a chain of its own; the agent continues it.
      chain: "",
      ask: reading.ask,
    }));
}
