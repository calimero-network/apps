import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, kvStore } from "./kvStore";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    const kv = kvStore({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    await Promise.all([
      kv.set("k", "v"),
      kv.updateIfExists("k", "v"),
      kv.getOrInsert("k", "v"),
      kv.remove("k"),
      kv.clear(),
      kv.entries(),
      kv.len(),
      kv.get("k"),
      kv.getUnchecked("k"),
      kv.getResult("k"),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe("kvStore", () => {
  it("routes calls through the log and views to a node, unwrapping the result", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: true, events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: "2" });
    const after = vi.fn();
    const kv = kvStore({ call, view }, "app-1", after);

    expect(await kv.updateIfExists("k", "v")).toBe(true);
    expect(call).toHaveBeenCalledWith("app-1", "updateIfExists", { key: "k", value: "v" });
    expect(await kv.len()).toBe("2");
    expect(view).toHaveBeenCalledWith("app-1", "len", {});
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const kv = kvStore({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error("boom")) }, "a", after);
    await expect(kv.getResult("x")).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(1);
  });
});
