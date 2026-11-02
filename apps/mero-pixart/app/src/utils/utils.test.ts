// The small pure helpers: escaping, truncation and team-name caching.
// Individually trivial, collectively the difference between a readable UI and
// a raw-ID one.

import { describe, it, expect, beforeEach } from "vitest";
import { clampText, escapeCss, escapeHtml, MAX_COMMENT_LEN } from "./sanitize";
import { truncateMiddle } from "./format";
import { getStoredTeamName, setStoredTeamName, teamLabel } from "./teamName";

describe("escapeHtml", () => {
  it("escapes every character that could break out of a template", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">`))
      .toBe("&lt;img src=x onerror=&quot;alert(&#x27;1&#x27;)&quot;&gt;");
  });

  it("escapes ampersands first, so entities are not double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Sunset Ridge — 18:44")).toBe("Sunset Ridge — 18:44");
  });
});

describe("escapeCss", () => {
  it("strips the characters that could close a style block or a declaration", () => {
    // Colons survive on purpose — they are legal inside a property VALUE
    // (`url(data:…)`), and it is the braces and semicolons that let a value
    // escape into a new rule.
    expect(escapeCss("red; } body { display:none")).toBe("red  body  display:none");
    expect(escapeCss("a\\b")).toBe("ab");
  });
});

describe("clampText", () => {
  it("trims and hard-caps", () => {
    expect(clampText("  hello  ", 100)).toBe("hello");
    expect(clampText("abcdef", 3)).toBe("abc");
    expect(clampText("abc", 3)).toBe("abc");
  });

  it("exposes a comment cap the UI can show", () => {
    expect(MAX_COMMENT_LEN).toBeGreaterThan(0);
    expect(clampText("x".repeat(MAX_COMMENT_LEN + 10), MAX_COMMENT_LEN)).toHaveLength(MAX_COMMENT_LEN);
  });
});

describe("truncateMiddle", () => {
  it("keeps short strings intact", () => {
    expect(truncateMiddle("short", 12, 8)).toBe("short");
    expect(truncateMiddle("")).toBe("");
  });

  it("elides the middle of a long string", () => {
    const out = truncateMiddle("abcdefghijklmnopqrstuvwxyz", 5, 3);
    expect(out).toBe("abcde…xyz");
  });
});

describe("teamName cache", () => {
  beforeEach(() => localStorage.clear());

  it("stores and reads a name back", () => {
    setStoredTeamName("g1", "  Design  ");
    expect(getStoredTeamName("g1")).toBe("Design");
  });

  it("ignores empty ids and blank names", () => {
    setStoredTeamName("", "Nope");
    setStoredTeamName("g2", "   ");
    expect(getStoredTeamName("g2")).toBe("");
    expect(getStoredTeamName("")).toBe("");
  });

  it("prefers the server name, then the cache, then a short id", () => {
    setStoredTeamName("abcdef123456", "Cached");
    expect(teamLabel("abcdef123456", "From server")).toBe("From server");
    expect(teamLabel("abcdef123456", "  ")).toBe("Cached");
    expect(teamLabel("zzzzzz999999")).toBe("Team zzzzzz");
  });
});
