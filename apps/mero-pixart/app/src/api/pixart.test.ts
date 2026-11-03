import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import abiJson from "../../../logic/res/abi.json";
import { invoke, isView, messageOf, methodOf, toWire, V1_METHODS } from "./pixart";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = abiJson as unknown as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

describe("the adapter covers the contract", () => {
  it("maps every v1 method to exactly the contract's methods", () => {
    const mapped = Object.values(V1_METHODS).sort();
    const contract = Object.entries(abi.methods)
      .filter(([, m]) => m.kind !== "init")
      .map(([name]) => name)
      .sort();
    expect(mapped).toEqual(contract);
  });

  it("names every argument the screens send as the ABI declares it", () => {
    // Every v1 snake_case argument the screens use, per method.
    const sent: Record<string, string[]> = {
      update_layer: ["id", "name", "visible", "locked", "opacity", "blend_mode", "x", "y", "width", "height", "rotation", "scale_x", "scale_y", "fill", "updated_at"],
      update_transform: ["id", "rotation", "scale_x", "scale_y", "skew_x", "skew_y", "flip_h", "flip_v", "warp", "updated_at"],
      update_layer_content: ["id", "blob_id", "width", "height", "updated_at"],
      update_layer_mask: ["id", "mask_blob_id", "updated_at"],
      move_layer: ["id", "parent_id", "layer_index", "updated_at"],
      move_layers: ["moves", "updated_at"],
      reorder_layers: ["order", "updated_at"],
      transfer_ownership: ["new_owner"],
      join: ["username", "avatar", "timestamp"],
      update_cursor: ["x", "y", "updated_at"],
    };
    for (const [v1, keys] of Object.entries(sent)) {
      const method = methodOf(v1);
      const args = Object.fromEntries(keys.map((k) => [k, 1]));
      const params = abi.methods[method].params.map(([n]) => n).sort();
      expect(Object.keys(toWire(method, args)).sort(), v1).toEqual(params);
    }
  });

  it("sends 64-bit integers as decimal strings and leaves the rest alone", () => {
    expect(toWire("updateCursor", { x: 10.7, y: -4, updated_at: 1700000000000 })).toEqual({
      x: "10",
      y: "-4",
      updatedAt: "1700000000000",
    });
    expect(toWire("updateLayer", { id: "l", opacity: 40, x: null, name: undefined, updated_at: 3 })).toEqual({
      id: "l",
      opacity: 40,
      x: null,
      updatedAt: "3",
    });
  });

  it("reads with views and writes with calls", async () => {
    const client = {
      view: vi.fn().mockResolvedValue({ index: 1, result: [] }),
      call: vi.fn().mockResolvedValue({ index: 2, result: "l1", events: [] }),
    };
    expect(isView("getLayers")).toBe(true);
    expect(await invoke(client, "app", "get_layers")).toEqual([]);
    expect(client.view).toHaveBeenCalledWith("app", "getLayers", {});
    expect(await invoke(client, "app", "add_layer", { layer: { id: "l1" } })).toBe("l1");
    expect(client.call).toHaveBeenCalledWith("app", "addLayer", { layer: { id: "l1" } });
  });
});

describe("messageOf", () => {
  it("says v1's words for the contract's refusals", () => {
    const err = (appCode: string, fields: Record<string, unknown> = {}) =>
      Object.assign(Object.create(AppError.prototype), { appCode, fields, message: appCode });
    expect(messageOf(err("ViewOnly"))).toMatch(/view-only/);
    expect(messageOf(err("OwnerOnly"))).toMatch(/owner/);
    expect(messageOf(err("Invalid", { message: "bad blob" }))).toBe("bad blob");
    // `rpcWithFallback` reads this as a missing method.
    expect(messageOf(err("UnknownMethod"))).toMatch(/method\s+.*not found/);
  });
});
