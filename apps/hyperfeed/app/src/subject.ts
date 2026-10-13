/**
 * What a row is about in another app, as a key: `<app>:<context>`, plus
 * `:<id>` for one thing in it (an issue, a doc, a thread). An action names
 * what it touched; a notification is about the thing its reply goes to. A
 * notification with no chain of its own joins the chain that last touched the
 * same thing, so a task's thread holds what teammates say about its work.
 *
 * Mirrors `subject_key` and `reply_subject` in `logic/src/lib.rs`, and
 * mero-bot keys the agent's writes the same way: change all three or none.
 */

/** The args that name the one thing a call is about, first match wins. */
export const SUBJECT_ARGS = ["issue_id", "doc_id", "thread_id"] as const;

const MAX_KEY = 200;

export function subjectKey(app: string, context: string, id: string): string {
  if (!app || !context) return "";
  const key = id ? `${app}:${context}:${id}` : `${app}:${context}`;
  return new TextEncoder().encode(key).length > MAX_KEY ? "" : key;
}

/** What a notification is about: the thing its reply goes to; `""` when it has no reply. */
export function replySubject(app: string, context: string, replyCall: string): string {
  let call: unknown;
  try {
    call = JSON.parse(replyCall);
  } catch {
    return "";
  }
  if (!call || typeof call !== "object" || Array.isArray(call)) return "";
  const args = (call as { args?: unknown }).args;
  const named = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const id = SUBJECT_ARGS.map((k) => named[k]).find((v): v is string => typeof v === "string" && v !== "") ?? "";
  return subjectKey(app, context, id);
}

/** A subject's parts: app, context, item (`""` for the whole context). Missing parts are `""`. */
export function splitSubject(subject: string): [string, string, string] {
  const [app = "", context = "", ...rest] = subject.split(":");
  return [app, context, rest.join(":")];
}
