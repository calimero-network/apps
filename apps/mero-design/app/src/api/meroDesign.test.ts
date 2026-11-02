import { describe, expect, it } from "vitest";
import abiText from "../../../logic/res/abi.json?raw";
import { METHODS, elementFromContract, elementToContract, toWire } from "./meroDesign";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(abiText) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

describe("the adapter covers the contract", () => {
  it("names exactly the contract's methods, each with its kind", () => {
    const ours = Object.values(METHODS)
      .map((m) => `${m.kind} ${m.name}`)
      .sort();
    const theirs = Object.entries(abi.methods)
      .filter(([, m]) => m.kind !== "init")
      .map(([name, m]) => `${m.kind} ${name}`)
      .sort();
    expect(ours).toEqual(theirs);
  });

  it("sends each method exactly the parameter names the ABI declares", () => {
    for (const spec of Object.values(METHODS)) {
      const ours = Object.values(spec.params).map(([name]) => name).sort();
      const theirs = abi.methods[spec.name]!.params.map(([name]) => name).sort();
      expect(ours, spec.name).toEqual(theirs);
    }
  });

  it("sends every 64-bit parameter as a decimal string, and nothing else", () => {
    for (const spec of Object.values(METHODS)) {
      const types = new Map(abi.methods[spec.name]!.params);
      for (const [name, wire] of Object.values(spec.params)) {
        const is64 = /^(option<)?[ui]64>?$/.test(types.get(name) ?? "");
        expect(wire === "int64", `${spec.name}.${name}`).toBe(is64);
      }
    }
  });
});

describe("toWire", () => {
  it("renames v1's method and arguments and stringifies 64-bit integers", () => {
    expect(
      toWire("update_element", { id: "a", x: 300, fill: "#fff", stroke_width: 2, updated_at: 1727000010000 }),
    ).toEqual({
      name: "updateElement",
      kind: "call",
      args: {
        id: "a",
        x: "300",
        y: null,
        width: null,
        height: null,
        rotation: null,
        fill: "#fff",
        stroke: null,
        strokeWidth: 2,
        opacity: null,
        cornerRadius: null,
        updatedAt: "1727000010000",
      },
    });
    expect(toWire("update_cursor", { x: -12.6, y: 4, updated_at: 5 }).args).toEqual({
      x: "-12",
      y: "4",
      updatedAt: "5",
    });
    expect(toWire("get_elements", {})).toEqual({
      name: "getElements",
      kind: "view",
      args: { cursor: null, limit: null },
    });
  });

  it("passes element records as they are; rpc.ts converts them first", () => {
    const element = { id: "e", createdAt: "1", layerIndex: 2 };
    expect(toWire("add_element", { element }).args).toEqual({ element });
  });
});

describe("elements on the contract", () => {
  const app = {
    id: "e", data: { kind: "image", naturalWidth: 4, naturalHeight: 2, blobId: "ab".repeat(32) },
    x: -12, y: 40, layerIndex: 3, createdAt: 1727000000000, updatedAt: 1727000000001,
  };
  const wire = { ...app, x: "-12", y: "40", createdAt: "1727000000000", updatedAt: "1727000000001" };

  it("sends the 64-bit fields as decimal strings and reads them back as numbers", () => {
    expect(elementToContract(app)).toEqual(wire);
    expect(elementFromContract(wire)).toEqual(app);
    expect(elementFromContract(null)).toBeNull();
  });

  it("sends no blobId while an image has none, never an empty one", () => {
    const pending = { ...app, data: { ...app.data, blobId: "" } };
    expect((elementToContract(pending).data as Record<string, unknown>)).not.toHaveProperty("blobId");
    expect(pending.data.blobId).toBe("");
  });

  it("refuses an argument the method does not take, and a method it does not have", () => {
    expect(() => toWire("join", { username: "a", avatar: null, timestamp: 1, member_id: "x" })).toThrow(
      /takes no argument member_id/,
    );
    expect(() => toWire("is_member", {})).toThrow(/no method is_member/);
    expect(() => toWire("join", { username: "a", timestamp: "soon" })).toThrow(/must be an integer/);
  });
});
