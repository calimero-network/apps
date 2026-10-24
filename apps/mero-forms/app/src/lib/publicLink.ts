import { IntentRefusedError, type NonceSource } from "@calimero-network/mero-js";
import type { FormIdentity } from "./formKey";

/**
 * A public link: a form key carried in the link itself, so anyone who opens
 * it can answer the form from their browser, signed in or not.
 *
 * The key rides in the URL's fragment (`/f#…`). A browser never sends the
 * fragment to the server it loads the page from, and never puts it in a
 * `Referer`, so Vercel serves the page without ever seeing the key; the page
 * reads it, signs each response with it and hands that to the relay. It is
 * not secret from whoever holds the link, and is not meant to be: it is the
 * same key a website's backend would hold, and it can answer this one form
 * and nothing else (see `formKey.ts` for why it can read nothing).
 */
export interface PublicLink {
  /** The relay the page writes through: one that serves the workspace's namespace. */
  relayUrl: string;
  contextId: string;
  formId: string;
  account: string;
  credential: string;
  deviceSecret: string;
}

/** The fill page's path. Its own path, so it is never mistaken for the app's hash routes. */
export const PUBLIC_PATH = "/f";

const toBase64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Short keys keep the link short; `v` lets a later shape be told apart. */
interface Wire {
  v: 1;
  r: string;
  c: string;
  f: string;
  a: string;
  p: string;
  s: string;
}

export function publicLinkUrl(origin: string, link: PublicLink): string {
  const wire: Wire = {
    v: 1,
    r: link.relayUrl,
    c: link.contextId,
    f: link.formId,
    a: link.account,
    p: link.credential,
    s: link.deviceSecret,
  };
  return `${origin.replace(/\/+$/, "")}${PUBLIC_PATH}#${toBase64Url(JSON.stringify(wire))}`;
}

export function publicLinkFrom(identity: FormIdentity, relayUrl: string, contextId: string, formId: string): PublicLink {
  return { relayUrl, contextId, formId, ...identity };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The link in a URL fragment, or null for anything that is not a whole, well-formed one. */
export function parsePublicLink(hash: string): PublicLink | null {
  const raw = hash.replace(/^#/, "");
  if (!raw) return null;
  let wire: Partial<Wire>;
  try {
    wire = JSON.parse(fromBase64Url(raw)) as Partial<Wire>;
  } catch {
    return null;
  }
  if (wire?.v !== 1) return null;
  const { r, c, f, a, p, s } = wire;
  if (typeof r !== "string" || !/^https?:\/\/[^\s]+$/.test(r)) return null;
  if (typeof c !== "string" || !HEX64.test(c)) return null;
  if (typeof f !== "string" || !/^[0-9a-f]{1,64}$/.test(f)) return null;
  if (typeof a !== "string" || !HEX64.test(a)) return null;
  if (typeof p !== "string" || !/^[0-9a-f]+$/.test(p)) return null;
  if (typeof s !== "string" || !HEX64.test(s)) return null;
  return { relayUrl: r, contextId: c, formId: f, account: a, credential: p, deviceSecret: s };
}

/**
 * Nonces for a key that many browsers share.
 *
 * A relay keeps one replay window per (context, author device, relay): the
 * highest nonce seen and the 64 below it. Every visitor's browser signs with
 * the same device, so a per-browser counter starting at 1 would be refused as
 * soon as anyone else had sent. The clock is the one sequence they share:
 * microseconds since the epoch, made strictly increasing within a tab.
 *
 * `skipMs` moves the sequence forward, for a send refused because a visitor
 * whose clock runs ahead of this one sent more recently.
 */
export function clockNonces(now: () => number = Date.now, jitter: () => number = randomJitter): NonceSource & {
  skipMs(ms: number): void;
} {
  let last = 0n;
  let ahead = 0n;
  return {
    next() {
      const stamp = (BigInt(Math.floor(now())) + ahead) * 1000n + BigInt(jitter());
      last = stamp > last ? stamp : last + 1n;
      return Promise.resolve(last);
    },
    advanceTo(floor: bigint) {
      if (floor > last) last = floor - 1n;
      return Promise.resolve();
    },
    skipMs(ms: number) {
      ahead += BigInt(ms);
    },
  };
}

/** 0..999: two visitors sending in the same millisecond rarely pick the same nonce. */
const randomJitter = () => crypto.getRandomValues(new Uint16Array(1))[0]! % 1000;

/**
 * How far a refused send skips ahead, try by try. The last is the relay's own
 * limit: a warrant lives five minutes, so a clock further off than that is
 * refused for its deadline anyway.
 */
export const SKIPS_MS = [0, 1_000, 10_000, 60_000, 300_000];

/**
 * Sends with fresh warrants until one is accepted. Only a refusal the relay
 * marks retryable (a nonce spent, or too old to judge) is tried again, each
 * time further ahead; anything else is the answer.
 */
export async function sendWithSkips<T>(
  nonces: ReturnType<typeof clockNonces>,
  send: () => Promise<T>,
  skips: number[] = SKIPS_MS,
): Promise<T> {
  let skipped = 0;
  for (let i = 0; ; i++) {
    try {
      return await send();
    } catch (e) {
      const next = skips[i + 1];
      if (!(e instanceof IntentRefusedError) || !e.retryable || next === undefined) throw e;
      nonces.skipMs(next - skipped);
      skipped = next;
    }
  }
}

/** What a visitor is told when the relay refuses, in their words rather than the relay's. */
export function publicRefusal(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  if (/form is closed/.test(why)) return "This form is closed and is not taking responses.";
  if (/another form|not a member|no longer|revoked/i.test(why)) return "This link no longer works. Ask whoever shared it for a new one.";
  if (/no form /.test(why)) return "This form no longer exists.";
  if (e instanceof IntentRefusedError) return `The response was not accepted: ${e.reason}`;
  if (e instanceof TypeError) return "Could not reach the form. Check your connection and try again.";
  return why;
}
