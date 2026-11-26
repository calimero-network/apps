import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID, NATIVE_APPROVE_CALLBACK, NATIVE_CALLBACK, memoryStorage } from "./native";

describe("the extension's callbacks", () => {
  it("are fixed URLs on the extension's chromiumapp.org origin", () => {
    expect(NATIVE_CALLBACK).toBe("https://ljpjgindjakdpmbpjdcpadihhnaemocf.chromiumapp.org/signed-in");
    expect(NATIVE_APPROVE_CALLBACK).toBe("https://ljpjgindjakdpmbpjdcpadihhnaemocf.chromiumapp.org/approved");
  });

  it("name the id the extension's manifest key pins", () => {
    const pinned = resolve(__dirname, "../../extension/extension-id.txt");
    let id: string | null = null;
    try {
      id = readFileSync(pinned, "utf8").trim();
    } catch {
      /* the extension is not in this checkout */
    }
    if (id !== null) expect(EXTENSION_ID).toBe(id);
  });
});

describe("memoryStorage", () => {
  it("keeps values for the page only", () => {
    const s = memoryStorage();
    expect(s.getItem("k")).toBeNull();
    s.setItem("k", "v");
    expect(s.getItem("k")).toBe("v");
    s.removeItem("k");
    expect(s.getItem("k")).toBeNull();
  });
});
