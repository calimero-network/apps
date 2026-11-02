import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, INT_PARAMS, PixartClient, VIEWS, camel, revOf, toLayer, toWireArgs, type Method, type WireLayer } from "./pixart";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const WIRE: WireLayer = {
  id: "l1",
  name: "Layer",
  kind: "raster",
  parentId: null,
  layerIndex: 2,
  visible: true,
  locked: false,
  opacity: 100,
  blendMode: "normal",
  x: "-12",
  y: "40",
  width: 300,
  height: 200,
  rotation: 0,
  scaleX: 100,
  scaleY: 100,
  skewX: 0,
  skewY: 0,
  flipH: false,
  flipV: false,
  warp: "",
  pixelsRev: "3",
  maskRev: "0",
  hasMask: false,
  fill: "",
  adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false, curves: "" },
  text: null,
  createdBy: "acct",
  createdAt: "1700000000000",
  updatedAt: "1700000000500",
};

function fakeTransport(pages: Record<string, unknown[]> = {}) {
  const calls: Array<{ kind: "call" | "view"; method: string; args: unknown }> = [];
  const transport = {
    call: vi.fn(async (_app: string, method: string, args: unknown) => {
      calls.push({ kind: "call", method, args });
      const queue = pages[method];
      return { index: 1, result: queue?.length ? queue.shift() : null, events: [] };
    }),
    view: vi.fn(async (_app: string, method: string, args: unknown) => {
      calls.push({ kind: "view", method, args });
      const queue = pages[method];
      return { index: 1, result: queue?.length ? queue.shift() : null };
    }),
  };
  return { transport, calls };
}

describe("the adapter covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends every 64-bit parameter as a decimal string, and only those", () => {
    for (const [name, m] of Object.entries(abi.methods)) {
      if (m.kind === "init") continue;
      const ints = m.params
        .filter(([, type]) => /^(option<)?[ui]64>?$/.test(type))
        .map(([p]) => p)
        .sort();
      expect([...(INT_PARAMS[name as Method] ?? [])].sort(), name).toEqual(ints);
    }
  });

  it("maps v1's snake_case names onto the ABI's", () => {
    for (const v1 of ["update_layer_content", "get_layers", "transfer_ownership", "bring_to_front", "list_roles"]) {
      expect(Object.keys(abi.methods)).toContain(camel(v1));
    }
    const wire = toWireArgs("updateLayer", { id: "l1", blend_mode: "screen", scale_x: 50, x: -3.6, updated_at: 7 });
    expect(wire).toEqual({ id: "l1", blendMode: "screen", scaleX: 50, x: "-3", updatedAt: "7" });
    for (const key of Object.keys(wire)) {
      expect(abi.methods.updateLayer.params.map(([p]) => p)).toContain(key);
    }
  });

  it("sends addLayer the editor's layer, without what the contract does not take", () => {
    const layer = { ...toLayer(WIRE), createdAt: 5, updatedAt: 6 };
    const wire = toWireArgs("addLayer", { layer }) as { layer: Record<string, unknown> };
    expect(wire.layer.x).toBe("-12");
    expect(wire.layer.createdAt).toBe("5");
    for (const k of ["blobId", "maskBlobId", "createdBy", "pixelsRev", "maskRev", "hasMask"]) {
      expect(wire.layer).not.toHaveProperty(k);
    }
  });
});

describe("answers in the screens' shape", () => {
  it("turns a wire layer into v1's, with its pixel revision as the cache key", () => {
    const l = toLayer(WIRE);
    expect(l.x).toBe(-12);
    expect(l.createdAt).toBe(1700000000000);
    expect(l.blobId).toBe("px:l1:3");
    expect(l.maskBlobId).toBeNull();
    expect(revOf(l.blobId)).toBe(3);
    expect(toLayer({ ...WIRE, pixelsRev: "0", hasMask: true, maskRev: "2" })).toMatchObject({
      blobId: "",
      maskBlobId: "mask:l1:2",
    });
  });

  it("follows `next` for a growing list, and answers it whole", async () => {
    const { transport, calls } = fakeTransport({
      getLayers: [
        { items: [WIRE], next: "c1" },
        { items: [{ ...WIRE, id: "l2" }], next: null },
      ],
    });
    const layers = await new PixartClient(transport).call<{ id: string }[]>("app", "get_layers", {});
    expect(layers.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(calls.map((c) => [c.kind, c.method, (c.args as { cursor: unknown }).cursor])).toEqual([
      ["view", "getLayers", null],
      ["view", "getLayers", "c1"],
    ]);
  });

  it("repeats clearLayers until nothing is left", async () => {
    const { transport, calls } = fakeTransport({
      clearLayers: [{ removed: 2, more: true }, { removed: 1, more: false }],
    });
    expect(await new PixartClient(transport).call("app", "clear_layers")).toBe(3);
    expect(calls.filter((c) => c.method === "clearLayers")).toHaveLength(2);
  });

  it("runs views as views and calls as calls, and refuses a removed method", async () => {
    const { transport, calls } = fakeTransport();
    const p = new PixartClient(transport);
    await p.call("app", "my_role");
    await p.call("app", "join", { username: "a", avatar: null, timestamp: 1 });
    expect(calls.map((c) => [c.kind, c.method])).toEqual([["view", "myRole"], ["call", "join"]]);
    expect(calls[1].args).toEqual({ username: "a", avatar: null, timestamp: "1" });
    await expect(p.call("app", "update_cursor", {})).rejects.toThrow(/no method/);
  });
});
