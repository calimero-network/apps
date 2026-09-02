import { describe, it, expect } from "vitest";
import { createMutationReporter, describeMutationFailure, isVersionSkew } from "./mutationErrors";

describe("isVersionSkew", () => {
  it("recognises a contract that is older than the UI", () => {
    for (const m of [
      "Method not found",
      "unknown method: set_layer_index",
      "unknown field `corner_radius`",
      "invalid type: map, expected unit variant ElementData::Line",
      "failed to deserialize args",
    ]) {
      expect(isVersionSkew(m), m).toBe(true);
    }
  });

  it("does not claim skew for ordinary failures", () => {
    for (const m of ["not an editor", "network error", "context not found", ""]) {
      expect(isVersionSkew(m), m).toBe(false);
    }
  });
});

describe("describeMutationFailure", () => {
  it("explains version skew in the user's terms, without jargon", () => {
    const msg = describeMutationFailure("set_layer_index", new Error("Method not found"));
    expect(msg).toContain("older version");
    expect(msg).not.toContain("set_layer_index");
  });

  it("names the method and the reason for anything else", () => {
    const msg = describeMutationFailure("add_element", new Error("not an editor"));
    expect(msg).toContain("add_element");
    expect(msg).toContain("not an editor");
  });

  it("survives a non-Error rejection", () => {
    expect(describeMutationFailure("update_element", undefined)).toContain("update_element");
  });
});

describe("createMutationReporter", () => {
  it("reports the first failure", () => {
    const seen: string[] = [];
    const onFail = createMutationReporter((m) => seen.push(m));
    onFail("set_layer_index", new Error("Method not found"));
    expect(seen).toHaveLength(1);
  });

  it("does not repeat the same message inside the window", () => {
    const seen: string[] = [];
    let t = 0;
    const onFail = createMutationReporter((m) => seen.push(m), 15_000, () => t);
    for (let i = 0; i < 20; i++) {
      t += 100;
      onFail("set_layer_index", new Error("Method not found"));
    }
    expect(seen).toHaveLength(1);
  });

  it("reports again once the window has passed", () => {
    const seen: string[] = [];
    let t = 0;
    const onFail = createMutationReporter((m) => seen.push(m), 1_000, () => t);
    onFail("set_layer_index", new Error("Method not found"));
    t = 2_000;
    onFail("set_layer_index", new Error("Method not found"));
    expect(seen).toHaveLength(2);
  });

  it("keeps distinct failures distinct", () => {
    const seen: string[] = [];
    const onFail = createMutationReporter((m) => seen.push(m));
    onFail("set_layer_index", new Error("Method not found"));
    onFail("add_element", new Error("not an editor"));
    expect(seen).toHaveLength(2);
  });
});
