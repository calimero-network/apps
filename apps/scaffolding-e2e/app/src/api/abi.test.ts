import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setConnection } from "../lib/calimero";
import * as api from "./kvStore";
import { int, u64 } from "./rpc";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]>; returns: string | null }>;
};

const SRC = resolve(__dirname, "..");
const ADAPTER = readFileSync(join(SRC, "api/kvStore.ts"), "utf8");

/**
 * `export const name = (...) => run<...>("v1_name", (c) => c.method(...))`:
 * section function → the v1 name it reports under and the generated method it calls.
 */
const ADAPTED = new Map(
  [...ADAPTER.matchAll(/export const (\w+) = \([^)]*\)\s*=>\s*run(?:<[^(]*?>)?\(\s*"(\w+)",\s*\(c\)\s*=>\s*c\.(\w+)\(/gs)].map(
    (m) => [m[1] as string, { v1: m[2] as string, method: m[3] as string }] as const,
  ),
);

/** `get_result` → `getResult`. */
const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe("the frontend covers the contract", () => {
  it("the adapter calls every method, by a name the ABI has, under its v1 name", () => {
    for (const { v1, method } of ADAPTED.values()) expect(camel(v1)).toBe(method);
    const called = new Set([...ADAPTED.values()].map(({ method }) => method));
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
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    setConnection({
      client: withRoutes({ call: vi.fn(record), view: vi.fn(record) }) as never,
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
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe("rpc", () => {
  afterEach(() => setConnection(null));

  it("sends 64-bit integers as decimal strings and reads them back as numbers", async () => {
    expect(u64(7)).toBe("7");
    expect(u64(7.9)).toBe("7");
    expect(u64("12")).toBe("12");
    expect(int("-2")).toBe(-2);

    const sent: Array<[string, unknown]> = [];
    const answer = (result: unknown) => async (_app: string, method: string, args: unknown) => {
      sent.push([method, args]);
      return { index: 1, result, events: [] };
    };
    setConnection({ client: withRoutes({ call: vi.fn(answer("4")), view: vi.fn(answer("4")) }) as never, appId: "app-1", org: null, accountId: "a", after: () => {} });
    await api.pushMetric(7);
    await api.uploadFile("n", "ab", 3, "x");
    expect(sent).toEqual([
      ["pushMetric", { value: "7" }],
      ["uploadFile", { name: "n", blobIdStr: "ab", size: "3", mimeType: "x" }],
    ]);
    // A u64 or i64 result is a number again; a string result stays a string.
    expect((await api.kvLen()).result?.output).toBe(4);
    expect((await api.getPnCounter("k")).result?.output).toBe(4);
    expect((await api.kvGet("k")).result?.output).toBe("4");
  });

  it("routes views to view and calls to call, and reports app errors in the envelope", async () => {
    const call = vi.fn().mockResolvedValue({ index: 2, result: null, events: [] });
    const view = vi.fn().mockRejectedValue(Object.assign(new Error("NotFound"), { appCode: "NotFound", fields: { key: "k" } }));
    const after = vi.fn();
    setConnection({ client: withRoutes({ call, view }) as never, appId: "app-1", org: null, accountId: "a", after });

    expect(await api.kvSet("k", "v")).toEqual({ result: { output: null } });
    expect(call).toHaveBeenCalledWith("app-1", "set", { key: "k", value: "v" });

    const res = await api.kvGetResult("k");
    expect(view).toHaveBeenCalledWith("app-1", "getResult", { key: "k" });
    expect(res.error).toMatchObject({ code: "NotFound", fields: { key: "k" } });
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("gives records back in v1's shape", async () => {
    const view = vi.fn().mockResolvedValue({
      index: 1,
      result: [{ id: "f", name: "a.txt", blobId: "ab", size: "12", mimeType: "text/plain", uploadedBy: "acct", uploadedAt: "1700" }],
    });
    setConnection({ client: withRoutes({ call: vi.fn(), view }) as never, appId: "app-1", org: null, accountId: "a", after: () => {} });
    const res = await api.listFiles();
    expect(res.result?.output).toEqual([
      { id: "f", name: "a.txt", blob_id: "ab", size: 12, mime_type: "text/plain", uploaded_by: "acct", uploaded_at: 1700 },
    ]);
  });

  it("throws without an open instance", async () => {
    await expect(api.kvLen()).rejects.toThrow(/No app instance open/);
  });
});
