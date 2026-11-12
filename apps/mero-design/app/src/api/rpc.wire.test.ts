import { beforeEach, describe, expect, it, vi } from "vitest";

import { bindApi } from "./client";
import { design, readElements, readElementsByIds, wireElement, wireLabel, wireLabels } from "./rpc";
import { withRoutes } from "@calimero-apps/connect/testing";
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

  it("addElement sends the extras inside label and no extra fields", () => {
    const wire = wireElement(el);
    expect(wire.label).toBe(`grp/Box${META_SEPARATOR}s=dashed`);
    expect(wire).not.toHaveProperty("strokeStyle");
  });

  it("a rename keeps the element's extras, read from the store", () => {
    expect(wireLabel("e1", "grp/Renamed")).toBe(`grp/Renamed${META_SEPARATOR}s=dashed`);
    expect(wireLabels([{ id: "e1", label: "grp/Renamed" }, { id: "gone", label: null }])).toEqual([
      { id: "e1", label: `grp/Renamed${META_SEPARATOR}s=dashed` },
      { id: "gone", label: null },
    ]);
  });

  it("an explicit element wins over the store's copy", () => {
    expect(wireLabel("e1", "grp/Box", { ...el, strokeStyle: "dotted" })).toBe(`grp/Box${META_SEPARATOR}s=dotted`);
  });

  it("the element reads come back unpacked", async () => {
    const wire = { ...el, strokeStyle: undefined, label: `grp/Box${META_SEPARATOR}s=dotted&b=box` };
    const view = vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result: method === "getElementsPage" ? { items: [wire], nextCursor: null } : [wire],
    }));
    bindApi({
      client: withRoutes({ view }),
      accountId: "acct",
      source: "bundle",
      passkey: () => ({ create: vi.fn(), get: vi.fn() }),
      after: () => {},
      scope: "local:acct",
    });
    try {
      const [one] = await readElements(design("b"));
      expect(one).toMatchObject({ label: "grp/Box", strokeStyle: "dotted", box: "box" });
      const [byId] = (await readElementsByIds(design("b"), ["e1"])) ?? [];
      expect(byId).toMatchObject({ label: "grp/Box", box: "box" });
    } finally {
      bindApi(null);
    }
  });
});
