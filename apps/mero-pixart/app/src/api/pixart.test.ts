import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { i64, messageOf, optI64, pixartClient } from "./pixart";
import { isMethodNotFoundError } from "./compat";
import { withRoutes } from "@calimero-apps/connect/testing";

const refusal = (appCode: string, fields: Record<string, unknown> = {}) =>
  Object.assign(Object.create(AppError.prototype), { appCode, fields, message: appCode });

describe("the wire", () => {
  it("sends 64-bit integers as whole decimal strings", () => {
    expect(i64(10.7)).toBe("10");
    expect(i64(-4)).toBe("-4");
    expect(i64(1700000000000)).toBe("1700000000000");
    expect(optI64(null)).toBeNull();
    expect(optI64(undefined)).toBeNull();
    expect(optI64(3)).toBe("3");
  });

  it("reads with views and writes with calls, and runs `after` either way", async () => {
    const client = withRoutes({
      view: vi.fn().mockResolvedValue({ index: 1, result: [] }),
      call: vi.fn().mockResolvedValue({ index: 2, result: "l1", events: [] }),
    });
    const after = vi.fn();
    const doc = pixartClient(client, "app", after);
    expect(await doc.getLayers()).toEqual([]);
    expect(client.view).toHaveBeenCalledWith("app", "getLayers", {});
    expect(await doc.addLayer({ layer: { id: "l1" } })).toBe("l1");
    expect(client.call).toHaveBeenCalledWith("app", "addLayer", { layer: { id: "l1" } });
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("turns a refusal into v1's words, which compat reads a missing method from", async () => {
    const original = refusal("UnknownMethod");
    const client = withRoutes({ call: vi.fn().mockRejectedValue(original), view: vi.fn().mockRejectedValue(refusal("ViewOnly")) });
    const doc = pixartClient(client, "app");
    const missing = await doc.moveLayers({ moves: [], updatedAt: "1" }).catch((e: unknown) => e);
    expect(isMethodNotFoundError(missing)).toBe(true);
    expect((missing as { cause?: unknown }).cause).toBe(original);
    await expect(doc.myRole()).rejects.toThrow(/view-only/);
  });
});

describe("messageOf", () => {
  it("says v1's words for the contract's refusals", () => {
    const err = refusal;
    expect(messageOf(err("ViewOnly"))).toMatch(/view-only/);
    expect(messageOf(err("OwnerOnly"))).toMatch(/owner/);
    expect(messageOf(err("Invalid", { message: "bad blob" }))).toBe("bad blob");
    // `rpcWithFallback` reads this as a missing method.
    expect(messageOf(err("UnknownMethod"))).toMatch(/method\s+.*not found/);
  });
});
