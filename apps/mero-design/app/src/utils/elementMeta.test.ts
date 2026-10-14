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

// Locked and hidden ride the label like every other extra, so the contract and
// the stored element layout are unchanged. What must hold is that a label
// written before the flags existed reads as unlocked and shown.
describe("locked / hidden flags", () => {
  const SEP = "\u001F";

  it("a label from before the flags existed reads as unlocked and shown", () => {
    for (const stored of [null, undefined, "", "Logo", "screen/01 Sign in", `Card${SEP}s=dashed&b=box`, `${SEP}h=star`]) {
      const { meta } = unpackLabel(stored);
      expect(meta.locked).toBeUndefined();
      expect(meta.hidden).toBeUndefined();
    }
  });

  it("an element read from an old board carries neither flag", () => {
    const el = fromWire({ ...base, id: "old", label: `Card${SEP}s=dashed` });
    expect(el.locked).toBeUndefined();
    expect(el.hidden).toBeUndefined();
    expect(el.strokeStyle).toBe("dashed");
    expect(el.label).toBe("Card");
  });

  it("round-trips both flags next to the other extras and a group path", () => {
    const packed = packLabel("hero/Logo", { strokeStyle: "dotted", locked: true, hidden: true });
    expect(packed?.startsWith(`hero/Logo${SEP}`)).toBe(true);
    expect(unpackLabel(packed)).toEqual({
      label: "hero/Logo",
      meta: { strokeStyle: "dotted", locked: true, hidden: true },
    });
  });

  it("only '1' sets a flag; any other value reads as off", () => {
    expect(unpackLabel(`x${SEP}l=0&i=true`).meta).toEqual({});
  });

  it("clearing both flags puts back the label exactly as it was", () => {
    const el = { ...base, id: "a", label: "Logo", locked: true, hidden: true };
    expect(toWire(el).label).toBe(`Logo${SEP}l=1&i=1`);
    expect(toWire({ ...el, locked: false, hidden: false }).label).toBe("Logo");
  });

  it("toWire / fromWire round-trip the flags and strip them from the stored element", () => {
    const wire = toWire({ ...base, id: "a", label: null, locked: true });
    expect(wire).not.toHaveProperty("locked");
    expect(fromWire(wire)).toMatchObject({ id: "a", label: null, locked: true });
  });
});
