/**
 * A public link: a form anyone can answer without signing in.
 *
 * The link is a core API key of the teammate who made it, limited to this
 * workspace (app instance) and to `linkForm` and `submitViaLink` (v1 used a
 * node's access grant; on Calimero 1.0 the API key is the same idea, made with
 * the teammate's passkey). Its URL carries the workspace and the key in the
 * fragment (`/f#a=…&t=…`). A browser never sends the fragment to the server it
 * loads the page from, and never puts it in a `Referer`, so the key reaches
 * only the cluster. The contract knows the link by the key's SHA-256 and
 * keeps no secret.
 *
 * Whoever holds the key can call those two methods in this one workspace and
 * nothing else, and the contract takes a response only while the form is
 * public, under the link's hourly cap, and with a captcha pass when the form
 * asks for one.
 */
export interface LinkTarget {
  /** The workspace: an app instance id. */
  app: string;
  /** The API key. */
  token: string;
}

/** The fill page's path. Its own path, so it is never mistaken for the app's hash routes. */
export const PUBLIC_PATH = "/f";

/** The contract methods a public link's key may call. */
export const LINK_METHODS = ["linkForm", "submitViaLink"] as const;

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
  if (/\s/.test(app) || app.length > 256 || token.length < 16 || /\s/.test(token)) return null;
  return { app, token };
}

/** Lowercase hex SHA-256 of `text`, as the contract keys a link by its key. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A captcha pass's nonce: 16 random bytes, hex. Each is accepted once. */
export function newNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a visitor is told when a call fails, in their words rather than the cluster's. */
export function publicRefusal(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: unknown } | null)?.status;
  // The contract's word for a deleted link; the cluster's 401/403 for a
  // revoked or expired key.
  if (/no longer works/i.test(why) || status === 401 || status === 403) {
    return "This link no longer works. Ask whoever shared it for a new one.";
  }
  if (/not taking responses from links/.test(why)) return "This form is not taking responses right now.";
  if (/form is closed/.test(why)) return "This form is closed and is not taking responses.";
  if (/this hour/.test(why)) return "This form has had a lot of responses in the last hour. Try again later.";
  if (/captcha/i.test(why)) return "The human check did not go through. Please try again.";
  if (e instanceof TypeError) return "Could not reach the form. Check your connection and try again.";
  return why;
}
