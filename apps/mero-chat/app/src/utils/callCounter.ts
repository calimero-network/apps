/**
 * Development only: counts every call this page makes to the node, by route
 * (`orgs.get`, `apps.list`, …) and, for an app's own methods, by method
 * (`view getMessages`, `call sendMessage`). Every call travels the sealed
 * channel (`/sealed/v2`), so the network panel cannot tell them apart.
 *
 * In the console: `__chatCalls.table()`, `__chatCalls.reset()`.
 */
import type { CalimeroClient } from "@calimero-network/mero-js";

interface Entry {
  at: number;
  key: string;
}

const log: Entry[] = [];

function record(key: string): void {
  log.push({ at: Date.now(), key });
}

function counts(since = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of log) if (e.at >= since) out[e.key] = (out[e.key] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

const api = {
  log,
  counts,
  reset: () => void log.splice(0),
  table: (since = 0) => console.table(counts(since)),
};

/** Wraps `client`'s route methods in place, once. */
export function countCalls(client: CalimeroClient): void {
  const c = client as unknown as Record<string, unknown> & { __counted?: boolean };
  if (c.__counted) return;
  c.__counted = true;
  (globalThis as unknown as { __chatCalls?: typeof api }).__chatCalls = api;
  for (const group of Object.keys(c)) {
    const routes = c[group];
    if (group === "transport" || !routes || typeof routes !== "object" || Array.isArray(routes)) continue;
    for (const name of Object.keys(routes)) {
      const fn = (routes as Record<string, unknown>)[name];
      if (typeof fn !== "function") continue;
      (routes as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
        const method = (args[0] as { method?: unknown } | undefined)?.method;
        record(
          group === "apps" && (name === "view" || name === "call") && typeof method === "string"
            ? `${name} ${method}`
            : `${group}.${name}`,
        );
        return (fn as (...a: unknown[]) => unknown).apply(this ?? routes, args);
      };
    }
  }
  const events = (client as unknown as { events?: (...a: unknown[]) => unknown }).events;
  if (typeof events === "function") {
    (client as unknown as { events: (...a: unknown[]) => unknown }).events = function (this: unknown, ...args: unknown[]) {
      record("events (stream opened)");
      return events.apply(client, args);
    };
  }
}
