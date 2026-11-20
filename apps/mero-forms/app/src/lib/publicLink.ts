/**
 * A public link: a form anyone can answer without signing in.
 *
 * The link is one of core's public links of this workspace (app instance): a
 * grant core keeps, made with the passkey of a teammate who may change the
 * workspace's access (`lib/coreLinks.ts`). Its URL carries the workspace and
 * the link's token in the fragment (`/f#a=…&t=…`). A browser never sends the
 * fragment to the server it loads the page from, and never puts it in a
 * `Referer`, so the token reaches only the cluster. Core keeps only the
 * token's public key (the link's key), and so does the contract, which binds
 * that key to one form.
 *
 * Whoever holds the token calls this workspace as an anonymous visitor
 * (signed with a key of their own browser), and only its two public methods,
 * `linkForm` and `submitViaLink`, which answer the form the link is bound to.
 * The contract takes a response only while the form is public, under the
 * link's hourly cap, and with a captcha pass when the form asks for one; core
 * stops the link when it is revoked or expires.
 */
export interface LinkTarget {
  /** The workspace: an app instance id. */
  app: string;
  /** The link's token. */
  token: string;
}

/** The fill page's path. Its own path, so it is never mistaken for the app's hash routes. */
export const PUBLIC_PATH = "/f";

export function publicLinkUrl(origin: string, target: LinkTarget): string {
  const fragment = new URLSearchParams({ a: target.app, t: target.token });
  return `${origin.replace(/\/+$/, "")}${PUBLIC_PATH}#${fragment.toString()}`;
}

/** The target a `/f` URL's fragment names, or null for anything that is not a whole one. */
export function parsePublicLink(hash: string): LinkTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const app = params.get("a")?.trim();
  const token = params.get("t")?.trim();
  if (!app || !token) return null;
  // A token is `pl_` and 32 bytes, base64url; it travels in a `vis1.` bearer
  // split on dots, so it never holds one.
  if (/\s/.test(app) || app.length > 256 || token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }
  return { app, token };
}

/** How long a new link lives: the choices the Connect tab offers. */
export const LINK_LIFETIMES = [
  { label: "Until deleted", days: 0 },
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

/**
 * A link's expiry for `days` from `nowMs`: core's (Unix seconds) and the
 * contract's (ms, "0" for none), the same instant.
 */
export function linkExpiry(days: number, nowMs: number): { core?: number; contract: string } {
  if (days <= 0) return { contract: "0" };
  const secs = Math.floor(nowMs / 1000) + days * 24 * 3600;
  return { core: secs, contract: String(secs * 1000) };
}

/** The label core keeps on a link: the form and the teammate's label, one line, at most 64 characters. */
export function coreLabel(formTitle: string, label: string): string {
  const parts = ["Forms", formTitle.trim(), label.trim()].filter(Boolean);
  return parts.join(" · ").replace(/\s+/g, " ").slice(0, 64);
}

/** A captcha pass's nonce: 16 random bytes, hex. Each is accepted once. */
export function newNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a visitor is told when a call fails, in their words rather than the cluster's. */
export function publicRefusal(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: unknown } | null)?.status;
  // The contract's word for a deleted or expired link; core's 401 for a
  // revoked or expired one, and 403 for anything a link may not do.
  if (/no longer works/i.test(why) || status === 401 || status === 403) {
    return "This link no longer works. Ask whoever shared it for a new one.";
  }
  // Core's per-visitor rate (`429 TOO_MANY_VISITS`).
  if (status === 429) return "Too many tries in a short time. Wait a minute and try again.";
  if (/not taking responses from links/.test(why)) return "This form is not taking responses right now.";
  if (/form is closed/.test(why)) return "This form is closed and is not taking responses.";
  if (/this hour/.test(why)) return "This form has had a lot of responses in the last hour. Try again later.";
  if (/captcha/i.test(why)) return "The human check did not go through. Please try again.";
  if (e instanceof TypeError) return "Could not reach the form. Check your connection and try again.";
  return why;
}
