import { DEPLOY_NOT_GRANTED_MESSAGE, isDeployNotGranted } from "@calimero-apps/connect";

/**
 * Pull a human-readable message out of an unknown thrown error.
 *
 * mero-js's `HTTPError` carries the node's own words for a failure as
 * `explanation` (the body's `error` / `detail`, where governance rejections
 * live) and a `message` prefixed with the status; prefer the former. A
 * `NotForAccountError` — an operation that only a node can do, asked of an
 * account — names the method; say so plainly rather than leaking a bare 403.
 */
export function extractErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (isDeployNotGranted(err)) return DEPLOY_NOT_GRANTED_MESSAGE;
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; method?: unknown; explanation?: unknown; message?: unknown };
    if (e.name === "NotForAccountError") {
      return "This needs a node login: an account cannot do this through its relay.";
    }
    if (typeof e.explanation === "string" && e.explanation.trim()) return e.explanation.trim();
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  return fallback;
}

/**
 * Turn raw node rejections into friendlier copy. The most common one here is the
 * namespace-admin gate on creating projects (subgroups), e.g.
 *   "GroupCreated rejected: signer … is neither an admin of namespace … nor a
 *    member holding CAN_CREATE_SUBGROUP at the namespace root"
 */
export function humanizeError(msg: string): string {
  if (/neither an admin|CAN_CREATE_SUBGROUP|not an admin|holding CAN_/i.test(msg)) {
    return "You don't have permission to create projects in this team. Ask a team admin to promote you.";
  }
  return msg;
}

/**
 * Whether the node refused a board because this account no longer reaches it
 * (`403`: taken out of the team; `404`: the board was deleted). Retrying
 * cannot help: the board is closed instead.
 */
export function accessLost(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 403 || status === 404;
}
