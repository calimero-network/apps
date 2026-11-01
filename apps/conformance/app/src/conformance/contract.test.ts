import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, contract } from "./contract";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]>; confirm: boolean; public: boolean }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

describe("the adapter covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("the confirm and public methods are the ones the matrix treats so", () => {
    const flagged = (flag: "confirm" | "public") =>
      Object.entries(abi.methods)
        .filter(([, m]) => m[flag])
        .map(([n]) => n);
    expect(flagged("confirm")).toEqual(["confirmedSet"]);
    expect(flagged("public")).toEqual(["publicGet"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result = /Len$|^len$|VecPush$/.test(method) ? "0" : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const c = contract({ call: vi.fn(record), view: vi.fn(record), callConfirmed: vi.fn(record) }, "app-1");
    await Promise.all([
      c.set("k", "v"),
      c.confirmedSet("k", "v"),
      c.remove("k"),
      c.setUserSimple("v"),
      c.addFrozen("v"),
      c.authoredInsert("k", "v"),
      c.authoredUpdate("k", "v"),
      c.authoredRemove("k"),
      c.authoredVecPush("v"),
      c.authoredVecUpdate(0, "v"),
      c.sharedSet("v"),
      c.sharedAddWriter("acct"),
      c.get("k"),
      c.publicGet("k"),
      c.getResult("k"),
      c.getUnchecked("k"),
      c.len(),
      c.myAccount(),
      c.getUserSimple(),
      c.getUserSimpleFor("acct"),
      c.getFrozen("h"),
      c.authoredGet("k"),
      c.authoredGetOwner("k"),
      c.authoredVecGet(0),
      c.authoredVecGetOwner(0),
      c.authoredVecLen(),
      c.sharedGet(),
      c.sharedGetWriters(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it("turns u64 answers into numbers and sends indexes as decimal strings", async () => {
    const view = vi.fn((_app: string, method: string) =>
      Promise.resolve({ index: 1, result: method === "len" ? "12" : "x" }),
    );
    const call = vi.fn(() => Promise.resolve({ index: 1, result: "3", events: [] }));
    const c = contract({ call, view, callConfirmed: vi.fn() }, "app-1");
    expect(await c.len()).toBe(12);
    expect(await c.authoredVecPush("v")).toBe(3);
    await c.authoredVecGet(7);
    expect(view).toHaveBeenLastCalledWith("app-1", "authoredVecGet", { index: "7" });
    view.mockResolvedValueOnce({ index: 1, result: 12 as unknown as string });
    await expect(c.len()).rejects.toThrow(/decimal string/);
  });

  it("confirmedSet uses the passkey step-up only when given a passkey", async () => {
    const call = vi.fn(() => Promise.resolve({ index: 1, result: null, events: [] }));
    const callConfirmed = vi.fn(() => Promise.resolve({ index: 2, result: null, events: [] }));
    const c = contract({ call, view: vi.fn(), callConfirmed }, "app-1");
    const passkey = { create: vi.fn(), get: vi.fn() };
    await c.confirmedSet("k", "v");
    await c.confirmedSet("k", "v", passkey);
    expect(call).toHaveBeenCalledWith("app-1", "confirmedSet", { key: "k", value: "v" });
    expect(callConfirmed).toHaveBeenCalledWith("app-1", "confirmedSet", { key: "k", value: "v" }, passkey);
  });
});
