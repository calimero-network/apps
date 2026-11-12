import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { MeroChessClient, type AppTransport } from "./generated/client";
import { withRoutes } from "@calimero-apps/connect/testing";

/**
 * `src/generated/client.ts` is `mero-app-build codegen`'s output for the
 * committed ABI (`logic/res/abi.json`, which CI rebuilds and diffs); CI also
 * regenerates the client and fails when it is stale. These tests are the same
 * promise without a Rust toolchain: the class the UI calls covers exactly the
 * contract, routes each method the way the node runs it, and keeps the stored
 * session current.
 */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};
const methods = Object.entries(abi.methods).filter(([, m]) => m.kind !== "init");

// A signed-in mero-js client is what useChess.ts hands the class: if mero-js's
// `apps.call` / `apps.view` / `events` drift from the generated `AppTransport`,
// this stops compiling (`tsc -b` covers the tests).
const _fits = (client: CalimeroClient): AppTransport => client;
void _fits;

/** The class's own methods, `events` aside. */
const ownMethods = Object.getOwnPropertyNames(MeroChessClient.prototype)
  .filter((name) => name !== "constructor" && name !== "events")
  .sort();

/** Calls `name` with every parameter the ABI declares, set to `"x"`. */
function invoke(c: MeroChessClient, name: string, params: Array<[string, string]>): Promise<unknown> {
  const method = (c as unknown as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>)[name];
  if (!method) throw new Error(`MeroChessClient has no method ${name}`);
  return params.length ? method.call(c, Object.fromEntries(params.map(([p]) => [p, "x"]))) : method.call(c);
}

describe("the generated client covers the contract", () => {
  it("has exactly the contract's methods", () => {
    expect(ownMethods).toEqual(methods.map(([name]) => name).sort());
    expect(Object.values(abi.methods).filter((m) => m.kind === "init")).toHaveLength(1);
  });

  it("sends calls through the log and views as views, with the ABI's parameter names", async () => {
    const sent = new Map<string, { route: string; args: string[] }>();
    const record = (route: string) => async (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, { route, args: Object.keys(args as object).sort() });
      return { index: 1, result: null, events: [] };
    };
    const c = new MeroChessClient(withRoutes({ call: vi.fn(record("call")), view: vi.fn(record("view")) }), "app-1");
    await Promise.all(methods.map(([name, m]) => invoke(c, name, m.params)));
    for (const [name, m] of methods) {
      expect(sent.get(name), name).toEqual({ route: m.kind, args: m.params.map(([p]) => p).sort() });
    }
  });

  it("runs `after` after every request, refused ones included", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "e4", events: [] });
    const view = vi.fn().mockResolvedValueOnce({ index: 1, result: [] }).mockRejectedValue(new Error("boom"));
    const after = vi.fn();
    const c = new MeroChessClient(withRoutes({ call, view }), "app-1", { after });

    expect(await c.play({ uci: "e2e4", now: "1700000000123" })).toBe("e4");
    expect(call).toHaveBeenCalledWith("app-1", "play", { uci: "e2e4", now: "1700000000123" });
    expect(await c.history()).toEqual([]);
    expect(view).toHaveBeenCalledWith("app-1", "history", {});
    await expect(c.table({ now: "1" })).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(3);
  });

  it("reads the table's events from the app's stream", async () => {
    const events = vi.fn(async function* () {
      yield { id: "1", kind: "Moved", data: { by: "acct-a", game: 0, ply: 0, san: "e4" } };
    });
    const c = new MeroChessClient(withRoutes({ events }), "app-1");
    const seen = [];
    for await (const event of c.events()) seen.push(event);
    expect(seen).toEqual([{ id: "1", kind: "Moved", data: { by: "acct-a", game: 0, ply: 0, san: "e4" } }]);
    expect(events).toHaveBeenCalledWith("app-1", 0, undefined);
  });
});
