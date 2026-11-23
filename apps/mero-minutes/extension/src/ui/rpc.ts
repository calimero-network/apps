import type { Reply, Request } from "../lib/messages";

/** Asks the service worker; rejects with its sentence on failure. */
export async function ask<T = unknown>(request: Request): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(request)) as Reply<T> | undefined;
  if (!reply) throw new Error("Minutes did not answer. Reload the extension and try again.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
