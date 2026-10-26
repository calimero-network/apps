/**
 * Core access grants: a token that lets someone with no account call a few
 * named methods in one context, as the node that issued it.
 *
 * A public link is one grant naming `link_form` and `submit_via_link` only.
 * A teammate's node issues it (`POST /admin-api/contexts/:id/grants`) and the
 * visitor presents its token on the node's public `/grant-calls` route, so
 * the visitor is no member of anything and reaches nothing else.
 *
 * Plain `fetch` rather than the mero-js admin client, as in Mero Calendar
 * (`apps/mero-calendar/app/src/api/accessGrants.ts`, which this mirrors): the
 * mero-js release this repo pins has no methods for these routes yet.
 */

/** The contract methods a public link's visitor may call. */
export const LINK_METHODS = ["link_form", "submit_via_link"] as const;

export interface AccessGrant {
  grantId: string;
  methods: string[];
  label: string;
  createdAt: number;
  notAfter: number | null;
}

export interface CreatedAccessGrant extends AccessGrant {
  /** Shown once; the node keeps only its hash. */
  token: string;
}

/** A refusal from the node, carrying its HTTP status. */
export class AccessGrantError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccessGrantError";
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function errorFrom(res: Response): Promise<AccessGrantError> {
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const text = body.error ?? body.message;
    if (typeof text === "string" && text) message = text;
  } catch {
    /* not JSON — the status line stands */
  }
  return new AccessGrantError(message, res.status);
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw await errorFrom(res);
  const body = (await res.json()) as { data: T };
  return body.data;
}

/**
 * How the owner's calls reach their node: its URL, the current access token,
 * and a way to get a fresh one. `refresh` runs any call through mero-js, which
 * renews an expired token on its own; the request is then retried once.
 */
export interface OwnerNode {
  nodeUrl: string;
  token: () => string | null;
  refresh: () => Promise<unknown>;
}

async function ownerFetch<T>(
  node: OwnerNode,
  path: string,
  init: RequestInit,
): Promise<T> {
  const send = () => {
    const token = node.token();
    return fetch(`${trimSlash(node.nodeUrl)}/admin-api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };
  let res = await send();
  if (res.status === 401) {
    await node.refresh().catch(() => undefined);
    res = await send();
  }
  return unwrap<T>(res);
}

export function createAccessGrant(
  node: OwnerNode,
  contextId: string,
  request: { methods: readonly string[]; label?: string; notAfter?: number | null },
): Promise<CreatedAccessGrant> {
  return ownerFetch(node, `/contexts/${encodeURIComponent(contextId)}/grants`, {
    method: "POST",
    body: JSON.stringify({
      methods: request.methods,
      label: request.label ?? "",
      notAfter: request.notAfter ?? null,
    }),
  });
}

export function revokeAccessGrant(
  node: OwnerNode,
  contextId: string,
  grantId: string,
): Promise<{ grantId: string }> {
  return ownerFetch(
    node,
    `/contexts/${encodeURIComponent(contextId)}/grants/${encodeURIComponent(grantId)}`,
    { method: "DELETE" },
  );
}

/** Call `method` under a grant. No session, no credential but the token. */
export async function callWithGrant<T>(
  nodeUrl: string,
  contextId: string,
  token: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(
    `${trimSlash(nodeUrl)}/admin-api/contexts/${encodeURIComponent(contextId)}/grant-calls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, method, argsJson: args }),
    },
  );
  const data = await unwrap<{ returns: T }>(res);
  return data.returns;
}

/** Lowercase hex SHA-256 of `text`, as the contract keys a link by its token. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
