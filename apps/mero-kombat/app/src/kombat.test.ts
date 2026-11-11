import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, kombat, messageOf } from "./kombat";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
  errors: Record<string, unknown>;
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
    const k = kombat(withRoutes({ call: vi.fn(record), view: vi.fn(record) }), "app-1");
    await Promise.all([
      k.arena(),
      k.history(),
      k.join("n", "cryo"),
      k.pick("cryo"),
      k.sit("p1", "n", "cryo"),
      k.stand(),
      k.act({ match: 0, round: 0, id: 1, kind: "punch", hit: true, blocked: false }),
      k.rematch(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it("has words for every refusal the contract can answer", () => {
    for (const code of Object.keys(abi.errors)) {
      const e = new AppError("refused", { code, fields: {} });
      expect(messageOf(e), code).not.toBe(code);
    }
  });
});

describe("kombat", () => {
  it("sends act's arguments as the contract names them, now as a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 7, result: null, events: [] });
    const view = vi.fn().mockResolvedValue({ index: 9, result: { status: "waiting" } });
    const after = vi.fn();
    const k = kombat(withRoutes({ call, view }), "app-1", after, () => 1_700_000_000_123.7);

    await k.act({ match: 2, round: 1, id: 41, kind: "uppercut", hit: true, blocked: false });
    expect(call).toHaveBeenCalledWith("app-1", "act", {
      matchIndex: 2,
      round: 1,
      id: 41,
      kind: "uppercut",
      hit: true,
      blocked: false,
      now: "1700000000123",
    });
    expect(k.index()).toBe(7);
    expect(await k.arena()).toEqual({ status: "waiting" });
    expect(view).toHaveBeenCalledWith("app-1", "arena", { now: "1700000000123" });
    expect(k.index()).toBe(9);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too, and words the refusal like v1", async () => {
    const after = vi.fn();
    const refusal = new AppError("refused", { code: "CornerTaken", fields: {} });
    const k = kombat(withRoutes({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }), "a", after);
    await expect(k.sit("p1", "n", "cryo")).rejects.toBe(refusal);
    expect(after).toHaveBeenCalledTimes(1);
    expect(messageOf(refusal)).toBe("that corner is taken");
    expect(messageOf(new Error("boom"))).toBe("boom");
  });
});
