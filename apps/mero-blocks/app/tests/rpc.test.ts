import { describe, expect, it } from "vitest";
import { decodeOutput } from "../src/net/rpc";

describe("decodeOutput", () => {
  it("decodes a legacy u8[] byte array", () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify({ seed: 7 })));
    expect(decodeOutput(bytes)).toEqual({ seed: 7 });
  });

  it("parses a JSON string", () => {
    expect(decodeOutput('{"a":1}')).toEqual({ a: 1 });
  });

  it("keeps a non-JSON string as-is", () => {
    expect(decodeOutput("hello")).toBe("hello");
  });

  it("passes through already-parsed values", () => {
    expect(decodeOutput([{ k: "1,2,3", b: 4 }])).toEqual([{ k: "1,2,3", b: 4 }]);
    expect(decodeOutput(null)).toBeNull();
  });
});
