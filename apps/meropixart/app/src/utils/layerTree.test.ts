import { describe, it, expect } from "vitest";
import {
  ancestorIds, buildTree, childrenOf, commonParentId, contentCount, descendantIds,
  expandSelection, groupBounds, isDescendantOf, isEffectivelyLocked,
  isEffectivelyVisible, movableLayers, nextGroupName, topmostSelected, visibleRows,
} from "./layerTree";
import { makeGroup, makeLayer } from "../test/factories";
import type { Layer } from "../types";

/**
 * A document with two folders, one nested:
 *
 *   Header            (group, index 40)
 *     Logo            (index 30)
 *     Nav             (group, index 20)
 *       Nav item      (index 10)
 *   Background        (index 0)
 */
function doc(): Layer[] {
  return [
    makeLayer({ id: "bg", name: "Background", layerIndex: 0 }),
    makeLayer({ id: "nav-item", name: "Nav item", layerIndex: 10, parentId: "nav" }),
    makeGroup({ id: "nav", name: "Nav", layerIndex: 20, parentId: "header" }),
    makeLayer({ id: "logo", name: "Logo", layerIndex: 30, parentId: "header" }),
    makeGroup({ id: "header", name: "Header", layerIndex: 40 }),
  ];
}

const names = (rows: { layer: Layer }[]) => rows.map((r) => r.layer.id);

describe("buildTree", () => {
  it("nests by parentId and orders front-most first", () => {
    const tree = buildTree(doc());
    expect(names(tree)).toEqual(["header", "bg"]);
    const header = tree[0];
    expect(names(header.children)).toEqual(["logo", "nav"]);
    expect(names(header.children[1].children)).toEqual(["nav-item"]);
  });

  it("records depth for the panel's indentation", () => {
    const rows = visibleRows(buildTree(doc()));
    expect(rows.map((r) => [r.layer.id, r.depth])).toEqual([
      ["header", 0], ["logo", 1], ["nav", 1], ["nav-item", 2], ["bg", 0],
    ]);
  });

  it("treats a layer whose parent does not exist as top level", () => {
    const layers = [makeLayer({ id: "orphan", parentId: "ghost" })];
    expect(names(buildTree(layers))).toEqual(["orphan"]);
  });

  it("refuses to nest under a non-group, so a layer can never be a folder", () => {
    const layers = [
      makeLayer({ id: "plain", layerIndex: 1 }),
      makeLayer({ id: "child", parentId: "plain", layerIndex: 0 }),
    ];
    expect(names(buildTree(layers))).toEqual(["plain", "child"]);
  });

  it("survives a cycle in replicated state instead of hanging", () => {
    // Two peers each re-parented into the other before syncing.
    const layers = [
      makeGroup({ id: "a", parentId: "b", layerIndex: 1 }),
      makeGroup({ id: "b", parentId: "a", layerIndex: 0 }),
    ];
    const rows = visibleRows(buildTree(layers));
    // Both layers must still be reachable — degraded to a flat-ish list, not lost.
    expect(rows.map((r) => r.layer.id).sort()).toEqual(["a", "b"]);
  });

  it("survives a layer parented to itself", () => {
    const layers = [makeGroup({ id: "self", parentId: "self" })];
    expect(names(buildTree(layers))).toEqual(["self"]);
  });
});

describe("visibleRows", () => {
  it("hides the subtree of a collapsed folder", () => {
    const tree = buildTree(doc());
    expect(names(visibleRows(tree, { header: true }))).toEqual(["header", "bg"]);
    expect(names(visibleRows(tree, { nav: true })))
      .toEqual(["header", "logo", "nav", "bg"]);
  });

  it("shows everything when nothing is collapsed", () => {
    expect(visibleRows(buildTree(doc()), {})).toHaveLength(5);
    expect(visibleRows(buildTree(doc()))).toHaveLength(5);
  });
});

describe("descendants and ancestors", () => {
  it("collects a whole subtree at any depth", () => {
    expect(descendantIds(doc(), "header").sort()).toEqual(["logo", "nav", "nav-item"]);
    expect(descendantIds(doc(), "nav")).toEqual(["nav-item"]);
    expect(descendantIds(doc(), "bg")).toEqual([]);
  });

  it("lists ancestors nearest first", () => {
    expect(ancestorIds(doc(), "nav-item")).toEqual(["nav", "header"]);
    expect(ancestorIds(doc(), "header")).toEqual([]);
  });

  it("answers isDescendantOf both ways round", () => {
    const layers = doc();
    expect(isDescendantOf(layers, "nav-item", "header")).toBe(true);
    expect(isDescendantOf(layers, "header", "nav-item")).toBe(false);
    expect(isDescendantOf(layers, "bg", "header")).toBe(false);
  });

  it("lists direct children front-most first", () => {
    expect(childrenOf(doc(), "header").map((l) => l.id)).toEqual(["logo", "nav"]);
  });

  it("counts contents for the folder row badge", () => {
    expect(contentCount(doc(), "header")).toBe(3);
    expect(contentCount(doc(), "nav")).toBe(1);
  });
});

describe("expandSelection", () => {
  it("selecting a folder selects everything inside it", () => {
    const ids = expandSelection(doc(), ["header"]);
    expect(ids.sort()).toEqual(["header", "logo", "nav", "nav-item"]);
  });

  it("keeps the folder itself last, so it stays the primary layer", () => {
    const ids = expandSelection(doc(), ["header"]);
    expect(ids[ids.length - 1]).toBe("header");
  });

  it("keeps the caller's order for several ids", () => {
    const ids = expandSelection(doc(), ["bg", "nav"]);
    expect(ids[0]).toBe("bg");
    expect(ids[ids.length - 1]).toBe("nav");
  });

  it("never repeats a layer that is inside two selected folders", () => {
    const ids = expandSelection(doc(), ["header", "nav"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops ids that are not in the document", () => {
    expect(expandSelection(doc(), ["ghost"])).toEqual([]);
  });

  it("leaves a plain layer alone", () => {
    expect(expandSelection(doc(), ["bg"])).toEqual(["bg"]);
  });
});

describe("movableLayers", () => {
  it("moves a folder's whole subtree", () => {
    expect(movableLayers(doc(), ["header"]).map((l) => l.id).sort())
      .toEqual(["header", "logo", "nav", "nav-item"]);
  });

  it("leaves locked layers where they are", () => {
    const layers = doc().map((l) => (l.id === "logo" ? { ...l, locked: true } : l));
    expect(movableLayers(layers, ["header"]).map((l) => l.id)).not.toContain("logo");
  });

  it("returns nothing for an empty selection", () => {
    expect(movableLayers(doc(), [])).toEqual([]);
  });
});

describe("groupBounds", () => {
  it("covers the folder's contents, not the folder's own box", () => {
    const layers = [
      makeGroup({ id: "g", x: 0, y: 0, width: 1000, height: 1000 }),
      makeLayer({ id: "a", parentId: "g", x: 100, y: 100, width: 50, height: 50 }),
      makeLayer({ id: "b", parentId: "g", x: 200, y: 300, width: 50, height: 20 }),
    ];
    expect(groupBounds(layers, "g")).toEqual({ x: 100, y: 100, w: 150, h: 220 });
  });

  it("includes a rotated child's true extent", () => {
    const layers = [
      makeGroup({ id: "g" }),
      makeLayer({ id: "a", parentId: "g", x: 0, y: 0, width: 100, height: 100, rotation: 45 }),
    ];
    expect(Math.round(groupBounds(layers, "g").w)).toBe(Math.round(100 * Math.SQRT2));
  });

  it("falls back to its own box when the folder is empty", () => {
    const layers = [makeGroup({ id: "g", x: 5, y: 6, width: 20, height: 30 })];
    expect(groupBounds(layers, "g")).toEqual({ x: 5, y: 6, w: 20, h: 30 });
  });

  it("answers an empty box for an unknown id", () => {
    expect(groupBounds(doc(), "ghost")).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("nextGroupName", () => {
  it("picks the first free number", () => {
    expect(nextGroupName([])).toBe("Group 1");
    expect(nextGroupName([makeGroup({ name: "Group 1" })])).toBe("Group 2");
    expect(nextGroupName([makeGroup({ name: "Group 1" }), makeGroup({ name: "Group 3" })]))
      .toBe("Group 2");
  });

  it("ignores case and non-group layers with the same name", () => {
    expect(nextGroupName([makeGroup({ name: "group 1" })])).toBe("Group 2");
    expect(nextGroupName([makeLayer({ name: "Group 1" })])).toBe("Group 1");
  });
});

describe("commonParentId", () => {
  it("nests a new folder inside the one its members already share", () => {
    expect(commonParentId(doc(), ["logo", "nav"])).toBe("header");
    expect(commonParentId(doc(), ["nav-item"])).toBe("nav");
  });

  it("returns null when members live in different branches", () => {
    expect(commonParentId(doc(), ["logo", "bg"])).toBeNull();
    expect(commonParentId(doc(), [])).toBeNull();
  });
});

describe("topmostSelected", () => {
  it("drops a layer whose ancestor is also selected", () => {
    expect(topmostSelected(doc(), ["header", "logo", "nav-item"])).toEqual(["header"]);
  });

  it("keeps siblings", () => {
    expect(topmostSelected(doc(), ["logo", "nav"]).sort()).toEqual(["logo", "nav"]);
  });

  it("drops ids that do not exist", () => {
    expect(topmostSelected(doc(), ["ghost", "bg"])).toEqual(["bg"]);
  });

  it("de-duplicates", () => {
    expect(topmostSelected(doc(), ["bg", "bg"])).toEqual(["bg"]);
  });
});

describe("inherited flags", () => {
  it("a layer in a hidden folder is hidden", () => {
    const layers = doc().map((l) => (l.id === "header" ? { ...l, visible: false } : l));
    expect(isEffectivelyVisible(layers, "nav-item")).toBe(false);
    expect(isEffectivelyVisible(layers, "bg")).toBe(true);
  });

  it("a layer in a locked folder is locked", () => {
    const layers = doc().map((l) => (l.id === "nav" ? { ...l, locked: true } : l));
    expect(isEffectivelyLocked(layers, "nav-item")).toBe(true);
    expect(isEffectivelyLocked(layers, "logo")).toBe(false);
  });

  it("an unknown layer is neither visible nor locked", () => {
    expect(isEffectivelyVisible(doc(), "ghost")).toBe(false);
    expect(isEffectivelyLocked(doc(), "ghost")).toBe(false);
  });
});
