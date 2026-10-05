/**
 * Pull a human-readable message out of an unknown thrown error.
 *
 * mero-js's `HTTPError` carries the node's response body as `bodyText`, which
 * is where governance rejections live (`{ error: "..." }` / `{ message: "..." }`
 * or a bare string); that is preferred over the generic "HTTP 403" message.
 * Anything else falls back to the error's own message, then to `fallback`.
 */
export function extractErrorMessage(
  err: unknown,
  fallback = "Something went wrong",
): string {
  const bodyText = (err as { bodyText?: unknown } | null)?.bodyText;
  if (typeof bodyText === "string" && bodyText.trim()) {
    const text = bodyText.trim();
    try {
      const data = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
      if (typeof data?.message === "string" && data.message.trim())
        return data.message.trim();
    } catch {
      return text;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    const data = err as { error?: unknown; message?: unknown };
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
    if (typeof data.message === "string" && data.message.trim())
      return data.message.trim();
  }
  return fallback;
}

/**
 * Turn raw node rejections into friendlier copy. The most common one here is the
 * namespace-admin gate on creating calendars (subgroups).
 */
export function humanizeError(msg: string): string {
  if (/neither an admin|CAN_CREATE_SUBGROUP|not an admin|holding CAN_/i.test(msg)) {
    return "You don't have permission to create a calendar in this team. Ask a team admin to promote you.";
  }
  return msg;
}
