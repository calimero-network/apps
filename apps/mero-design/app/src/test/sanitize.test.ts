import { describe, it, expect } from "vitest";
import { escapeHtml, escapeCss, clampText, MAX_COMMENT_LEN, MAX_REPLY_LEN } from "../utils/sanitize";

describe("escapeHtml", () => {
  it("escapes < and >", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes &", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("neutralises XSS payload", () => {
    const xss = '<script>alert("xss")</script>';
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("passes through safe text unchanged", () => {
    expect(escapeHtml("Hello world")).toBe("Hello world");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("escapeCss", () => {
  it("removes braces that could break a style block", () => {
    expect(escapeCss("red}body{background:red")).not.toContain("}");
    expect(escapeCss("red}body{background:red")).not.toContain("{");
  });

  it("removes semicolons", () => {
    expect(escapeCss("red;color:blue")).not.toContain(";");
  });

  it("passes through a valid hex colour", () => {
    expect(escapeCss("#4F8EF7")).toBe("#4F8EF7");
  });

  it("passes through rgba()", () => {
    expect(escapeCss("rgba(0,0,0,0.3)")).toBe("rgba(0,0,0,0.3)");
  });
});

describe("clampText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(clampText("  hello  ", 100)).toBe("hello");
  });

  it("truncates at max length", () => {
    const long = "a".repeat(MAX_COMMENT_LEN + 10);
    expect(clampText(long, MAX_COMMENT_LEN).length).toBe(MAX_COMMENT_LEN);
  });

  it("does not truncate text within limit", () => {
    expect(clampText("short", MAX_REPLY_LEN)).toBe("short");
  });

  it("MAX_COMMENT_LEN is 2000", () => {
    expect(MAX_COMMENT_LEN).toBe(2000);
  });

  it("MAX_REPLY_LEN is 500", () => {
    expect(MAX_REPLY_LEN).toBe(500);
  });
});
