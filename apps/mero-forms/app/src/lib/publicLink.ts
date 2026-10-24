import { AccessGrantError } from "./accessGrants";

/**
 * A public link: a form anyone can answer without signing in.
 *
 * The link is a core access grant on a teammate's node (see
 * `accessGrants.ts`). Its URL carries the node, the workspace and the grant's
 * token in the fragment (`/f#n=…&c=…&t=…`). A browser never sends the
 * fragment to the server it loads the page from, and never puts it in a
 * `Referer`, so the token reaches only the node it is for. The contract knows
 * the link by the token's SHA-256 and keeps no secret.
 *
 * The token is not a member's key: whoever holds it can call `link_form` and
 * `submit_via_link` in this one workspace and nothing else, and the contract
 * takes a response only while the form is public, under the link's hourly
 * cap, and with a captcha pass when the form asks for one.
 */
export interface LinkTarget {
  /** The node holding the grant: what the visitor's browser calls. */
  nodeUrl: string;
  contextId: string;
  /** The grant's token, 64 hex. */
  token: string;
}

/** The fill page's path. Its own path, so it is never mistaken for the app's hash routes. */
export const PUBLIC_PATH = "/f";

export function publicLinkUrl(origin: string, target: LinkTarget): string {
  const fragment = new URLSearchParams({ n: target.nodeUrl, c: target.contextId, t: target.token });
  return `${origin.replace(/\/+$/, "")}${PUBLIC_PATH}#${fragment.toString()}`;
}

/** The target a `/f` URL's fragment names, or null for anything that is not a whole one. */
export function parsePublicLink(hash: string): LinkTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const nodeUrl = params.get("n");
  const contextId = params.get("c");
  const token = params.get("t");
  if (!nodeUrl || !contextId || !token) return null;
  if (!/^https?:\/\/\S+$/i.test(nodeUrl)) return null;
  if (!/^[0-9a-f]{64}$/i.test(contextId)) return null;
  if (!/^[0-9a-f]{64}$/i.test(token)) return null;
  return { nodeUrl, contextId, token };
}

/** A captcha pass's nonce: 16 random bytes, hex. Each is accepted once. */
export function newNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a visitor is told when a call fails, in their words rather than the node's. */
export function publicRefusal(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  // The contract's word for a deleted link, and the node's for a revoked or expired grant.
  if (/no longer works|access grant is not valid|access grant has expired/i.test(why)) {
    return "This link no longer works. Ask whoever shared it for a new one.";
  }
  if (/not taking responses from links/.test(why)) return "This form is not taking responses right now.";
  if (/form is closed/.test(why)) return "This form is closed and is not taking responses.";
  if (/this hour/.test(why)) return "This form has had a lot of responses in the last hour. Try again later.";
  if (/captcha/i.test(why)) return "The human check did not go through. Please try again.";
  if (e instanceof AccessGrantError) return `The response was not accepted: ${why}`;
  if (e instanceof TypeError) return "Could not reach the form. Check your connection and try again.";
  return why;
}
