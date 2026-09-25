import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios");
vi.mock("@calimero-network/mero-react", () => ({ getNodeUrl: () => "", clearAllStorage: () => {} }));

import { packArgs, unpackResult } from "./rpc";
import { useCanvasStore } from "../store/canvasStore";
import { META_SEPARATOR } from "../utils/elementMeta";
import type { Element } from "../types";

const el: Element = {
  id: "e1", data: { kind: "rect" }, x: 0, y: 0, width: 10, height: 10, rotation: 0,
  fill: "transparent", stroke: "#000", strokeWidth: 4, opacity: 100, layerIndex: 0,
  createdBy: "", createdAt: 1, updatedAt: 1, label: "grp/Box", strokeStyle: "dashed",
};

describe("the RPC wire packs and unpacks element extras", () => {
  beforeEach(() => useCanvasStore.setState({ elements: [el] }));

  it("add_element sends the extras inside label and no extra fields", () => {
    const args = packArgs("add_element", { element: el }) as { element: Element };
    expect(args.element.label).toBe(`grp/Box${META_SEPARATOR}s=dashed`);
    expect(args.element).not.toHaveProperty("strokeStyle");
  });

  it("a rename keeps the element's extras, read from the store", () => {
    const args = packArgs("update_element_label", { id: "e1", label: "grp/Renamed", updated_at: 1 });
    expect(args.label).toBe(`grp/Renamed${META_SEPARATOR}s=dashed`);
  });

  it("an explicit __element wins and is not sent to the node", () => {
    const args = packArgs("update_element_label", {
      id: "e1", label: "grp/Box", updated_at: 1, __element: { ...el, strokeStyle: "dotted" },
    });
    expect(args.label).toBe(`grp/Box${META_SEPARATOR}s=dotted`);
    expect(args).not.toHaveProperty("__element");
  });

  it("other methods pass through untouched", () => {
    const a = { id: "e1", fill: "#fff" };
    expect(packArgs("update_element", a)).toBe(a);
  });

  it("get_elements and get_element come back unpacked", () => {
    const wire = { ...el, strokeStyle: undefined, label: `grp/Box${META_SEPARATOR}s=dotted&b=box` };
    const [one] = unpackResult("get_elements", [wire]) as Element[];
    expect(one).toMatchObject({ label: "grp/Box", strokeStyle: "dotted", box: "box" });
    expect(unpackResult("get_element", wire)).toMatchObject({ label: "grp/Box", box: "box" });
    expect(unpackResult("get_comments", [wire])).toEqual([wire]);
  });
});
