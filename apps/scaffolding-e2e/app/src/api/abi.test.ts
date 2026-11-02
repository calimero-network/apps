import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setConnection } from "../lib/calimero";
import { METHODS } from "./abi";
import * as api from "./kvStore";
import { camel, fromWire, mergeItems, readAllPages, rpcRaw, toWireArgs } from "./rpc";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]>; returns: string | null }>;
};

const SRC = resolve(__dirname, "..");
const ADAPTER = readFileSync(join(SRC, "api/kvStore.ts"), "utf8");

/** `export const name = (...) => call<...>("method", ...)`: adapter function → v1 method name. */
const ADAPTED = new Map(
  [...ADAPTER.matchAll(/export const (\w+) = \([^)]*\)\s*=>\s*call(?:<[^(]*?>)?\(\s*"(\w+)"/gs)].map((m) => [
    m[1] as string,
    m[2] as string,
  ]),
);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe("the frontend covers the contract", () => {
  it("abi.ts is the committed ABI", () => {
    const expected = Object.fromEntries(
      Object.entries(abi.methods)
        .filter(([, m]) => m.kind !== "init")
        .map(([name, m]) => [name, { view: m.kind === "view", params: m.params, returns: m.returns }]),
    );
    expect(METHODS).toEqual(expected);
  });

  it("the adapter calls every method, by a name the ABI has", () => {
    const called = new Set([...ADAPTED.values()].map(camel));
    for (const name of called) expect(abi.methods[name], name).toBeDefined();
    const missing = Object.keys(abi.methods).filter((m) => m !== "init" && !called.has(m));
    expect(missing).toEqual([]);
  });

  it("every adapter function is reachable from a screen", () => {
    // Sections and components, not the Test Runner: a method only the suite
    // calls is not one a person can try by hand.
    const ui = sources(SRC)
      .filter((f) => !f.endsWith("TestRunner.tsx") && !f.endsWith("kvStore.ts"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unreachable = [...ADAPTED.keys()].filter((fn) => !new RegExp(`\\b${fn}\\(`).test(ui));
    expect(unreachable).toEqual([]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const listing = METHODS[method]?.returns?.startsWith("Listing<");
      return Promise.resolve({ index: 1, result: listing ? { items: [], next: null } : null, events: [] });
    };
    setConnection({
      client: { call: vi.fn(record), view: vi.fn(record) } as never,
      appId: "app-1",
      org: null,
      accountId: "acct",
      after: () => {},
    });
    const fns = api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    for (const fn of ADAPTED.keys()) {
      const f = fns[fn];
      if (!f) throw new Error(`${fn} is not exported`);
      // Every argument a string or number; what is checked is the NAMES sent.
      await f(...Array.from({ length: f.length }, () => "1"));
    }
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      // A listing is read from its first page: the adapter leaves `cursor` and `limit` out.
      const params = method.returns?.startsWith("Listing<")
        ? method.params.filter(([p]) => p !== "cursor" && p !== "limit")
        : method.params;
      expect(sent.get(name), name).toEqual(params.map(([p]) => p).sort());
    }
  });
});

describe("rpc", () => {
  afterEach(() => setConnection(null));

  it("reads a listing page by page into v1's shape", async () => {
    const view = vi
      .fn()
      .mockResolvedValueOnce({ result: { items: { a: "1", k: "lowest" }, next: "c1" } })
      .mockResolvedValueOnce({ result: { items: { k: "higher", z: "2" }, next: null } });
    setConnection({ client: { call: vi.fn(), view } as never, appId: "app-1", org: null, accountId: "a", after: () => {} });
    expect(await rpcRaw("authored_entries")).toEqual({ result: { output: { a: "1", k: "lowest", z: "2" } } });
    expect(view).toHaveBeenNthCalledWith(1, "app-1", "authoredEntries", {});
    expect(view).toHaveBeenNthCalledWith(2, "app-1", "authoredEntries", { cursor: "c1" });

    // An explicit limit is one raw page.
    view.mockResolvedValueOnce({ result: { items: ["x"], next: "c2" } });
    expect(await rpcRaw("sorted_keys", { limit: 1 })).toEqual({ result: { output: { items: ["x"], next: "c2" } } });

    expect(mergeItems([1], [2, 3])).toEqual([1, 2, 3]);
    let n = 0;
    await expect(readAllPages(() => Promise.resolve({ items: [n++], next: "again" }))).rejects.toThrow(/pages/);
  });

  it("maps v1 names and integers onto the wire and back", () => {
    expect(camel("get_result")).toBe("getResult");
    expect(toWireArgs(METHODS.pushMetric, { value: 7 })).toEqual({ value: "7" });
    expect(toWireArgs(METHODS.uploadFile, { blob_id_str: "ab", size: 3, mime_type: "x", name: "n" })).toEqual({
      blobIdStr: "ab",
      size: "3",
      mimeType: "x",
      name: "n",
    });
    expect(fromWire(METHODS.len, "4")).toBe(4);
    expect(fromWire(METHODS.getPnCounter, "-2")).toBe(-2);
    expect(fromWire(METHODS.get, "4")).toBe("4");
  });

  it("routes views to view and calls to call, and reports app errors in the envelope", async () => {
    const call = vi.fn().mockResolvedValue({ index: 2, result: null, events: [] });
    const view = vi.fn().mockRejectedValue(Object.assign(new Error("NotFound"), { appCode: "NotFound", fields: { key: "k" } }));
    const after = vi.fn();
    setConnection({ client: { call, view } as never, appId: "app-1", org: null, accountId: "a", after });

    expect(await rpcRaw("set", { key: "k", value: "v" })).toEqual({ result: { output: null } });
    expect(call).toHaveBeenCalledWith("app-1", "set", { key: "k", value: "v" });

    const res = await rpcRaw("get_result", { key: "k" });
    expect(view).toHaveBeenCalledWith("app-1", "getResult", { key: "k" });
    expect(res.error).toMatchObject({ code: "NotFound", fields: { key: "k" } });
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("gives records back in v1's shape", async () => {
    const view = vi.fn().mockResolvedValue({
      index: 1,
      result: {
        items: [{ id: "f", name: "a.txt", blobId: "ab", size: "12", mimeType: "text/plain", uploadedBy: "acct", uploadedAt: "1700" }],
        next: null,
      },
    });
    setConnection({ client: { call: vi.fn(), view } as never, appId: "app-1", org: null, accountId: "a", after: () => {} });
    const res = await api.listFiles();
    expect(res.result?.output).toEqual([
      { id: "f", name: "a.txt", blob_id: "ab", size: 12, mime_type: "text/plain", uploaded_by: "acct", uploaded_at: 1700 },
    ]);
  });

  it("throws without an open instance", async () => {
    await expect(rpcRaw("len")).rejects.toThrow(/No app instance open/);
  });
});
