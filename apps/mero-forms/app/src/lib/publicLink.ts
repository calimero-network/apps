/**
 * A public link: a form anyone can answer without signing in.
 *
 * The link is a random token the teammate's browser makes. The contract keeps
 * only its SHA-256 (`createLink`), so the token in the link's URL is the only
 * way to open it, and anyone holding it reaches the two `#[app::public]`
 * methods of the workspace, `linkForm` and `submitViaLink`, for that one link,
 * signed in or not. Its URL carries the workspace and the token in the
 * fragment (`/f#a=…&t=…`). A browser never sends the fragment to the server it
 * loads the page from, and never puts it in a `Referer`, so the token reaches
 * only the cluster.
 *
 * The contract takes a response only while the form is public, under the
 * link's hourly cap, and with a captcha when the form asks for one. For an
 * anonymous visitor to reach those methods at all, the workspace's access is
 * `public` (its owner sets it from Connect → Public links).
 */
export interface LinkTarget {
  /** The workspace: an app instance id. */
  app: string;
  /** The link's token. */
  token: string;
}

/** The fill page's path. Its own path, so it is never mistaken for the app's hash routes. */
export const PUBLIC_PATH = "/f";

/** The contract's `#[app::public]` methods: all an anonymous visitor reaches. */
export const LINK_METHODS = ["linkForm", "submitViaLink"] as const;

/** A new link's token: 32 random bytes, hex. */
export function newLinkToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Where public links open. A page the cluster serves from the bundle only
 * reaches the cluster (its CSP), so it cannot load Cloudflare's Turnstile
 * widget: a deployment that wants captchas on links serves the `/f` page from
 * an origin of its own (`VITE_PUBLIC_FORM_ORIGIN`, e.g. the Vercel deploy)
 * and has the node's operator allow that origin. Otherwise, this page's own.
 */
export function publicFormOrigin(env: { VITE_PUBLIC_FORM_ORIGIN?: string }, fallback: string): string {
  const configured = env.VITE_PUBLIC_FORM_ORIGIN?.trim();
  return configured ? configured.replace(/\/+$/, "") : fallback;
}

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

/** The workspace's access as the cluster keeps it: who reaches it at all. */
export interface WorkspaceAccess {
  /** Anyone, signed in or not: what anonymous visitors of a link need. */
  public: boolean;
  /** The only account that may change it. */
  owner: string;
}

/** Reads `getApp`'s answer: `access.kind` and `owner`. */
export function toWorkspaceAccess(app: Record<string, unknown>): WorkspaceAccess {
  const access = app.access as { kind?: unknown } | undefined;
  return { public: access?.kind === "public", owner: typeof app.owner === "string" ? app.owner : "" };
}

/** Lowercase hex SHA-256 of `text`, as the contract keys a link by its token. */
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
  // workspace that is not open to public links.
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
