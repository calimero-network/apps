import axios from "axios";

/**
 * Pull a human-readable message out of an unknown thrown error.
 * Prefers the node's `{ error: "..." }` / `{ message: "..." }` response body
 * (where governance rejections live), then the axios/Error message.
 */
export function extractErrorMessage(
  err: unknown,
  fallback = "Something went wrong",
): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: unknown; message?: unknown }
      | undefined;
    if (data) {
      if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
      if (typeof data.message === "string" && data.message.trim())
        return data.message.trim();
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
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
