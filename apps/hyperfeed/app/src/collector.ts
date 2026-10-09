import type { NotificationInput } from "./generated/HyperfeedClient";
import { runLens, type LensHost, type LensSpec, type Outcome } from "./lens/lens";
import chatLens from "./lens/fixtures/chat.json";

/**
 * Turning another app's live events into Hyperfeed notifications.
 *
 * Every app on your node emits events as its state changes, and your node
 * streams them to any client subscribed to that context. An event is a `kind`
 * (`MessageSent`, `TextChanged`, …) plus JSON bytes the app chose; core does
 * not say who caused it or whether it concerns you. Nearly all of them are
 * bookkeeping (a keystroke, a cursor, a reaction), and your own node emits
 * them for your own edits too. So nothing is recorded by default: an event
 * becomes a notification only through a LENS for its app version, which your
 * agent learned from the app's ABI and you approved (see `lens/lens.ts`). The
 * lens reads what the event points at from the app, drops what you did
 * yourself, and keeps what concerns you, as one of the feed's item types.
 *
 * Until you approve one for Chat, Chat uses the lens this app ships
 * (`lens/fixtures/chat.json`): a DM, a mention of you or of everyone, and your
 * role changing.
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
 * ⚠️ mero-bot carries the same lens engine and keys (`src/hyperfeed/lens/`,
 * `src/hyperfeed/collect.ts`). Change both or neither.
 */

/** The `data` of a `StateMutation` context event. */
export interface StateMutation {
  newRoot?: string;
  events?: { kind?: string; data?: number[] | string | null }[];
}

export interface SourceContext {
  contextId: string;
  appKey: string;
  applicationId: string;
  label: string;
}

/** The lenses this app ships, used until you approve one for the same app. */
export const BUILT_IN: Record<string, LensSpec> = { chat: chatLens as LensSpec };

/** One event as it arrived, kept for a lens's preview. */
export interface RawEvent {
  kind: string;
  payload: unknown;
  at: number;
}

/**
 * The notifications in one state change: one per event the lens records. A
 * failed read drops its event; the rest of the change is still read.
 */
export async function toNotifications(
  source: SourceContext,
  mutation: StateMutation,
  /** The root this client last saw for the context, or "" for its first event. */
  previousRoot: string,
  lens: LensSpec | null,
  host: LensHost,
): Promise<NotificationInput[]> {
  const root = mutation.newRoot ?? "";
  if (!root || !lens) return []; // no stable key, or nothing to read it with
  const outcomes = await Promise.all(
    (mutation.events ?? []).map(async (event, index) => {
      const kind = event.kind ?? "";
      if (!kind) return null;
      const out: Outcome = await runLens(lens, kind, decodePayload(event.data), source, host);
      if (out.kind === "error") console.warn(`[hyperfeed] could not read ${source.appKey} ${kind}: ${out.why}`);
      return out.kind === "recorded" ? { kind, index, reading: out.reading } : null;
    }),
  );
  return outcomes
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(({ kind, index, reading }) => ({
      // The index is the event's place in the change, so a skipped event never shifts a key.
      key: clip(`${source.contextId}:${previousRoot.slice(0, 16)}>${root}:${index}`, 200),
      app: source.appKey,
      source_context: source.contextId,
      event: clip(kind, 120),
      // Every notification starts a chain of its own; the agent continues it.
      chain: "",
      ...reading,
    }));
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

/** Every form an app may write an identity in: as given, and base58 when it is hex. */
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
