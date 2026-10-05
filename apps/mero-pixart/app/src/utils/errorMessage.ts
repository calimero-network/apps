import { classifyError } from "@calimero-network/mero-js";

/**
 * Pull a human-readable message out of an unknown thrown error.
 *
 * Prefers the node's own words — mero-js's `HTTPError.explanation`, the
 * response body's `error` / `message` (where governance rejections live) —
 * over a message that only repeats the status line, then any `Error.message`,
 * then `fallback`. `NotForAccountError` and the relay's refusals arrive as plain
 * errors and read through unchanged.
 */
export function extractErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  const body = (err as { response?: { data?: unknown } } | null)?.response?.data as
    | { error?: unknown; message?: unknown }
    | undefined;
  if (body) {
    if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
    if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  }
  if (typeof err === "string") return err.trim() || fallback;
  if (err === null || err === undefined) return fallback;
  const msg = classifyError(err).message.trim();
  return msg || fallback;
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
