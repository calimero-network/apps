import { describe, expect, it } from "vitest";
import { fromWire, META_SEPARATOR, packLabel, toWire, unpackLabel } from "./elementMeta";
import type { Element } from "../types";

const base: Element = {
  id: "e1", data: { kind: "rect" }, x: 0, y: 0, width: 10, height: 10, rotation: 0,
  fill: "transparent", stroke: "#000", strokeWidth: 4, opacity: 100, layerIndex: 0,
  createdBy: "", createdAt: 1, updatedAt: 1,
};

describe("label codec", () => {
  it("leaves a label with no extras byte-for-byte alone", () => {
    expect(packLabel("screen/Home", {})).toBe("screen/Home");
    expect(packLabel(null, {})).toBeNull();
    expect(unpackLabel("screen/Home")).toEqual({ label: "screen/Home", meta: {} });
  });

  it("round-trips every extra", () => {
    const meta = {
      strokeStyle: "dotted3" as const, box: "sticky" as const, textColor: "#ff0000",
      shape: "star" as const, startBinding: "a:right", endBinding: "b:left",
    };
    const packed = packLabel("grp/Name", meta)!;
    expect(packed.startsWith(`grp/Name${META_SEPARATOR}`)).toBe(true);
    expect(unpackLabel(packed)).toEqual({ label: "grp/Name", meta });
  });

  it("an element with only extras has a null visible label", () => {
    const packed = packLabel(null, { strokeStyle: "dashed" })!;
    expect(unpackLabel(packed)).toEqual({ label: null, meta: { strokeStyle: "dashed" } });
  });

  it("never writes 'solid' and ignores unknown values", () => {
    expect(packLabel("x", { strokeStyle: "solid" })).toBe("x");
    expect(unpackLabel(`x${META_SEPARATOR}s=wavy&b=circle&h=blob`)).toEqual({ label: "x", meta: {} });
  });

  it("a slash-separated group path survives unchanged in front of the extras", () => {
    const packed = packLabel("screen/Pricing @3/cta", { box: "box" })!;
    expect(unpackLabel(packed).label).toBe("screen/Pricing @3/cta");
  });
});

describe("toWire / fromWire", () => {
  it("folds extras into the label and strips the fields", () => {
    const wire = toWire({ ...base, label: "Card", strokeStyle: "dashed", shape: "diamond" });
    expect(wire).not.toHaveProperty("strokeStyle");
    expect(wire).not.toHaveProperty("shape");
    expect(unpackLabel(wire.label).meta).toEqual({ strokeStyle: "dashed", shape: "diamond" });
    expect(fromWire(wire)).toMatchObject({ label: "Card", strokeStyle: "dashed", shape: "diamond" });
  });

  it("does not touch an element without extras (label stays undefined)", () => {
    const wire = toWire(base);
    expect(wire).toEqual(base);
    expect("label" in wire).toBe(false);
  });

  it("fromWire is idempotent and returns the same object when there is nothing to unpack", () => {
    const el = { ...base, label: "plain" };
    expect(fromWire(el)).toBe(el);
    const once = fromWire(toWire({ ...base, box: "box" }));
    expect(fromWire(once)).toBe(once);
  });
});
