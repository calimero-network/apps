import type { NotificationInput } from "./hyperfeedTypes";
import { runLens, type LensHost, type LensSpec, type Outcome } from "./lens/lens";
import calendarLens from "./lens/fixtures/calendar.json";
import chatLens from "./lens/fixtures/chat.json";
import crmLens from "./lens/fixtures/crm.json";
import issuesLens from "./lens/fixtures/issues.json";
import passLens from "./lens/fixtures/pass.json";
import sheetsLens from "./lens/fixtures/sheets.json";
import signLens from "./lens/fixtures/sign.json";

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
 * Until you approve one, each core app uses the lens this app ships
 * (`lens/fixtures/<app>.json`, keyed in {@link BUILT_IN}): in Chat a DM, a
 * mention of you or of everyone, and your role changing; in the others a
 * mention, an invite, a request to sign, or a change to what is yours.
 *
 * The dedupe key is `<app>:<event id>`. A component app's events are
 * numbered by the cluster's log (`<index>:<seq>`), the same on every device
 * that follows the app, so two of your devices watching it record one event
 * once. (v1 keyed by the context's state transition, `<previous root>><new
 * root>`, because its events carried no id.)
 *
 * ⚠️ mero-bot carries the same lens engine and keys (`src/hyperfeed/lens/`,
 * `src/hyperfeed/collect.ts`). Change both or neither.
 */

/** One event of another app, as the cluster streams it (`client.events`). */
export interface AppEvent {
  /** `<log index>:<seq>`: stable across devices. */
  id: string;
  kind: string;
  data: unknown;
}

/** A source of notifications: another app instance you reach (v1's context). */
export interface SourceContext {
  /** The app instance id. */
  contextId: string;
  appKey: string;
  /** The bundle it runs: what a lens is learned and approved for (v1's application id). */
  applicationId: string;
  label: string;
}

/** The lenses this app ships, used until you approve one for the same app. */
export const BUILT_IN: Record<string, LensSpec> = {
  chat: chatLens as LensSpec,
  calendar: calendarLens as LensSpec,
  sheets: sheetsLens as LensSpec,
  "issue-tracker": issuesLens as LensSpec,
  crm: crmLens as LensSpec,
  sign: signLens as LensSpec,
  pass: passLens as LensSpec,
};

/** One event as it arrived, kept for a lens's preview. */
export interface RawEvent {
  kind: string;
  payload: unknown;
  at: number;
}

/**
 * The notification one event makes, when the lens records it: none for an
 * event without a kind, without a lens, or that the lens drops. A failed read
 * drops the event, with a warning.
 */
export async function toNotifications(
  source: SourceContext,
  event: AppEvent,
  lens: LensSpec | null,
  host: LensHost,
): Promise<NotificationInput[]> {
  if (!event.id || !event.kind || !lens) return [];
  const out: Outcome = await runLens(lens, event.kind, decodePayload(event.data), source, host);
  if (out.kind === "error") console.warn(`[hyperfeed] could not read ${source.appKey} ${event.kind}: ${out.why}`);
  if (out.kind !== "recorded") return [];
  return [
    {
      key: clip(`${source.contextId}:${event.id}`, 200),
      app: source.appKey,
      source_context: source.contextId,
      event: clip(event.kind, 120),
      // Every notification starts a chain of its own; the agent continues it.
      chain: "",
      ...out.reading,
    },
  ];
}

/** The log index of an event id (`<index>:<seq>`), or null. */
export function indexOf(id: string): number | null {
  const n = Number(id.split(":")[0]);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
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

/**
 * The JSON an event carries (an object, a string, …), or `null` when it is not
 * JSON. The cluster streams it already parsed; bytes and JSON text are read too.
 */
export function decodePayload(data: unknown): unknown {
  if (data == null) return null;
  if (typeof data === "object" && !Array.isArray(data)) return data;
  if (typeof data !== "string" && !Array.isArray(data)) return data;
  try {
    const raw = typeof data === "string" ? data : new TextDecoder().decode(Uint8Array.from(data as number[]));
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
