import { describe, expect, it } from "vitest";

import {
  MAX_GROUP_NAME_BYTES,
  groupNameByteLength,
  groupNameError,
} from "./groupName";

describe("groupNameByteLength", () => {
  it("counts ASCII as one byte each", () => {
    expect(groupNameByteLength("general")).toBe(7);
  });

  it("counts what the server counts, not characters", () => {
    // The cap is on BYTES. "café" is 4 characters and 5 bytes; an emoji is one
    // character and four. A character-based check would let through a name the
    // server then drops.
    expect(groupNameByteLength("café")).toBe(5);
    expect(groupNameByteLength("🎉")).toBe(4);
  });

  it("is zero for an empty name", () => {
    expect(groupNameByteLength("")).toBe(0);
  });
});

describe("groupNameError", () => {
  it("accepts an ordinary name", () => {
    expect(groupNameError("general")).toBeNull();
  });

  it("accepts a name exactly at the limit", () => {
    expect(groupNameError("a".repeat(MAX_GROUP_NAME_BYTES))).toBeNull();
  });

  it("rejects one byte over", () => {
    // Measured against a live node: a 60-character name is stored, a 70-char
    // one is dropped with a 200 response and no error. Catching it here is the
    // difference between a message and silent data loss.
    expect(groupNameError("a".repeat(MAX_GROUP_NAME_BYTES + 1))).toMatch(/64/);
  });

  it("rejects a name that is short in characters but long in bytes", () => {
    // 20 emoji = 20 characters, 80 bytes. A `length > 64` check would pass it.
    const name = "🎉".repeat(20);
    expect(name.length).toBeLessThan(MAX_GROUP_NAME_BYTES);
    expect(groupNameError(name)).not.toBeNull();
  });

  it("rejects a blank name", () => {
    expect(groupNameError("   ")).not.toBeNull();
  });

  it("measures the trimmed name, since that is what gets sent", () => {
    const name = `  ${"a".repeat(MAX_GROUP_NAME_BYTES)}  `;
    expect(groupNameError(name)).toBeNull();
  });
});
