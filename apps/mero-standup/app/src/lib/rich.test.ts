import { describe, expect, it } from "vitest";
import { parseInline, parseRich } from "./rich";

describe("light formatting", () => {
  it("groups bullet lines into one list", () => {
    const blocks = parseRich("Did two things:\n- first\n* second\n1. third\n\nAfter");
    expect(blocks.map((b) => b.kind)).toEqual(["para", "list", "para"]);
    expect(blocks[1]).toMatchObject({ kind: "list", items: { length: 3 } });
  });

  it("finds links and code, and leaves trailing punctuation out of a link", () => {
    expect(parseInline("see https://example.com/pr/1. Run `make`")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: "https://example.com/pr/1", text: "https://example.com/pr/1" },
      { kind: "text", text: ". Run " },
      { kind: "code", text: "make" },
    ]);
  });

  it("never turns markup into anything but text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "text", text: "<img src=x onerror=alert(1)>" },
    ]);
    expect(parseInline("javascript:alert(1)")).toEqual([
      { kind: "text", text: "javascript:alert(1)" },
    ]);
  });
});
