import { describe, expect, it } from "vitest";
import { isInteractive, toggleFlag, visibleOnly } from "./layerFlags";
import type { Element } from "../types";

const el = (id: string, over: Partial<Element> = {}): Element => ({
  id, data: { kind: "rect" }, x: 0, y: 0, width: 10, height: 10, rotation: 0,
  fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 100, layerIndex: 0,
  createdBy: "", createdAt: 1, updatedAt: 1, ...over,
});

describe("layer flags", () => {
  it("only an unlocked, shown element on an editable board is interactive", () => {
    expect(isInteractive(el("a"), false)).toBe(true);
    expect(isInteractive(el("a"), true)).toBe(false);
    expect(isInteractive(el("a", { locked: true }), false)).toBe(false);
    expect(isInteractive(el("a", { hidden: true }), false)).toBe(false);
    expect(isInteractive(undefined, false)).toBe(false);
  });

  it("visibleOnly drops hidden elements", () => {
    expect(visibleOnly([el("a"), el("b", { hidden: true })]).map((e) => e.id)).toEqual(["a"]);
  });

  it("a mixed selection is locked as a whole; a fully locked one is unlocked", () => {
    const board = [el("a", { locked: true }), el("b"), el("c")];
    const lock = toggleFlag(board, ["a", "b"], "locked", 5);
    expect(lock.value).toBe(true);
    expect(lock.changed.map((e) => [e.id, e.locked, e.updatedAt])).toEqual([["b", true, 5]]);

    const unlock = toggleFlag([el("a", { locked: true }), el("b", { locked: true })], ["a", "b"], "locked", 6);
    expect(unlock.value).toBe(false);
    expect(unlock.changed.every((e) => !("locked" in e))).toBe(true);
  });

  it("unknown ids change nothing", () => {
    expect(toggleFlag([el("a")], ["zzz"], "hidden", 1).changed).toEqual([]);
  });
});
