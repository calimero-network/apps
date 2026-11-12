import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { MeroKombatClient } from "./generated/client";
import { indexed, messageOf, now } from "./kombat";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  errors: Record<string, unknown>;
};

describe("the contract's refusals", () => {
  it("has words for every refusal the contract can answer", () => {
    for (const code of Object.keys(abi.errors)) {
      const e = new AppError("refused", { code, fields: {} });
      expect(messageOf(e), code).not.toBe(code);
    }
  });
});

describe("calling the arena", () => {
  it("sends act's arguments as the contract names them, now as a decimal string, noting each answer's index", async () => {
    const call = vi.fn().mockResolvedValue({ index: 7, result: null, events: [] });
    const view = vi.fn().mockResolvedValue({ index: 9, result: { status: "waiting" } });
    const after = vi.fn();
    const watched = indexed(withRoutes({ call, view }));
    const k = new MeroKombatClient(watched.transport, "app-1", { after });
    const clock = () => 1_700_000_000_123.7;

    await k.act({ matchIndex: 2, round: 1, id: 41, kind: "uppercut", hit: true, blocked: false, now: now(clock) });
    expect(call).toHaveBeenCalledWith("app-1", "act", {
      matchIndex: 2,
      round: 1,
      id: 41,
      kind: "uppercut",
      hit: true,
      blocked: false,
      now: "1700000000123",
    });
    expect(watched.index()).toBe(7);
    expect(await k.arena({ now: now(clock) })).toEqual({ status: "waiting" });
    expect(view).toHaveBeenCalledWith("app-1", "arena", { now: "1700000000123" });
    expect(watched.index()).toBe(9);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too, and words the refusal like v1", async () => {
    const after = vi.fn();
    const refusal = new AppError("refused", { code: "CornerTaken", fields: {} });
    const k = new MeroKombatClient(withRoutes({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }), "a", { after });
    await expect(k.sit({ seat: "p1", name: "n", fighter: "cryo", now: now() })).rejects.toBe(refusal);
    expect(after).toHaveBeenCalledTimes(1);
    expect(messageOf(refusal)).toBe("that corner is taken");
    expect(messageOf(new Error("boom"))).toBe("boom");
  });
});
