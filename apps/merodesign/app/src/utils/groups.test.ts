import { describe, it, expect } from "vitest";
import type { Element } from "../types";
import {
  buildLayerTree,
  commonGroupPath,
  derivedName,
  groupElements,
  groupPathOf,
  nameOf,
  renameElement,
  renameGroup,
  sanitizeName,
  siblingGroupNames,
  ungroupPath,
  uniqueGroupName,
  type GroupNode,
} from "./groups";

function el(id: string, label: string | null, layerIndex = 0, extra: Partial<Element> = {}): Element {
  return {
    id,
    data: { kind: "rect" },
    x: 0, y: 0, width: 10, height: 10,
    rotation: 0, fill: "#000", stroke: "transparent", strokeWidth: 0, opacity: 100,
    layerIndex,
    createdBy: "", createdAt: 0, updatedAt: 0,
    label,
    ...extra,
  };
}

describe("label paths", () => {
  it("reads the group out of a path label", () => {
    expect(groupPathOf("screen/01 Sign in")).toBe("screen");
    expect(groupPathOf("topbar/actions/logo")).toBe("topbar/actions");
    expect(groupPathOf("rule")).toBe("");
    expect(groupPathOf(null)).toBe("");
  });

  it("keeps the separator out of names", () => {
    expect(sanitizeName("a/b")).toBe("a-b");
    expect(renameElement(el("x", "screen/old"), "new")).toBe("screen/new");
    expect(renameElement(el("x", "screen/old"), "a/b")).toBe("screen/a-b");
  });

  it("names a text layer after its content, like Figma", () => {
    const text = el("t", null, 0, { data: { kind: "text", content: "  Sign  in  now " } });
    expect(derivedName(text)).toBe("Sign in now");
    expect(nameOf(text)).toBe("Sign in now");
    expect(derivedName(el("r", null))).toBe("rect");
  });

  it("truncates a long text name", () => {
    const text = el("t", null, 0, { data: { kind: "text", content: "x".repeat(60) } });
    expect(derivedName(text)).toHaveLength(28);
    expect(derivedName(text).endsWith("…")).toBe(true);
  });
});

describe("buildLayerTree", () => {
  const elements = [
    el("a", "screen/01 Sign in", 1),
    el("b", "screen/02 Overview", 5),
    el("c", "topbar/logo", 3),
    el("d", "rule", 2),
    el("e", null, 9),
  ];

  it("nests elements under their group", () => {
    const tree = buildLayerTree(elements);
    const groups = tree.filter((n) => n.kind === "group") as GroupNode[];
    expect(groups.map((g) => g.path).sort()).toEqual(["screen", "topbar"]);
    const screen = groups.find((g) => g.path === "screen")!;
    expect(screen.children.map((c) => c.kind === "element" && c.id)).toEqual(["b", "a"]);
  });

  it("sorts front-most first, and a group by its front-most member", () => {
    const tree = buildLayerTree(elements);
    // e (9) then screen (max 5) then topbar (3) then rule (2)
    expect(tree.map((n) => (n.kind === "group" ? n.path : n.id))).toEqual(["e", "screen", "topbar", "d"]);
  });

  it("collects every descendant id on each ancestor group", () => {
    const tree = buildLayerTree([
      el("a", "topbar/actions/save", 1),
      el("b", "topbar/logo", 2),
    ]);
    const topbar = tree.find((n) => n.kind === "group") as GroupNode;
    expect(topbar.elementIds.sort()).toEqual(["a", "b"]);
    const actions = topbar.children.find((n) => n.kind === "group") as GroupNode;
    expect(actions.elementIds).toEqual(["a"]);
  });

  it("applies a local rename before the contract round-trips", () => {
    const tree = buildLayerTree([el("a", "screen/old", 1)], { a: "screen/new" });
    const screen = tree[0] as GroupNode;
    expect(screen.children[0].name).toBe("new");
  });
});

describe("grouping", () => {
  it("creates the group inside the deepest shared parent", () => {
    const elements = [el("a", "screen/one"), el("b", "screen/two"), el("c", "other")];
    expect(commonGroupPath([elements[0], elements[1]])).toBe("screen");
    const patch = groupElements(elements, ["a", "b"], "Header");
    expect(patch).toEqual({ a: "screen/Header/one", b: "screen/Header/two" });
    expect(patch.c).toBeUndefined();
  });

  it("groups at the root when the selection spans groups", () => {
    const elements = [el("a", "screen/one"), el("b", "other/two")];
    expect(commonGroupPath(elements)).toBe("");
    expect(groupElements(elements, ["a", "b"], "Mix")).toEqual({
      a: "Mix/screen/one",
      b: "Mix/other/two",
    });
  });

  it("names an unlabelled element as it is grouped", () => {
    const elements = [el("a", null), el("b", null, 0, { data: { kind: "circle" } })];
    expect(groupElements(elements, ["a", "b"], "Blobs")).toEqual({
      a: "Blobs/rect",
      b: "Blobs/circle",
    });
  });

  it("dissolves a group into its parent", () => {
    const elements = [
      el("a", "screen/Header/one"),
      el("b", "screen/Header/deep/two"),
      el("c", "screen/other"),
    ];
    expect(ungroupPath(elements, "screen/Header")).toEqual({
      a: "screen/one",
      b: "screen/deep/two",
    });
  });

  it("does not touch an element merely named after the group", () => {
    // "screen" here is a leaf's own name, not a group — dissolving the group
    // "screen" must not blank it.
    const elements = [el("leaf", "screen"), el("member", "screen/one")];
    const patch = ungroupPath(elements, "screen");
    expect(patch).toEqual({ member: "one" });
  });

  it("renames a group and every descendant with it", () => {
    const elements = [
      el("a", "screen/one"),
      el("b", "screen/deep/two"),
      el("c", "screen"),
      el("d", "other/three"),
    ];
    expect(renameGroup(elements, "screen", "Screens")).toEqual({
      a: "Screens/one",
      b: "Screens/deep/two",
    });
  });

  it("picks a free sibling name", () => {
    const elements = [el("a", "Group 1/x"), el("b", "Group 2/y"), el("c", "screen/Group 1/z")];
    expect(siblingGroupNames(elements, "").sort()).toEqual(["Group 1", "Group 2", "screen"]);
    expect(uniqueGroupName(siblingGroupNames(elements, ""))).toBe("Group 3");
    expect(siblingGroupNames(elements, "screen")).toEqual(["Group 1"]);
    expect(uniqueGroupName(siblingGroupNames(elements, "screen"))).toBe("Group 2");
  });
});
