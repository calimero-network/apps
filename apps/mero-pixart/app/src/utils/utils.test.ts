// The small pure helpers: escaping, truncation, team-name caching, error
// humanising and invitation encoding. Individually trivial, collectively the
// difference between a readable UI and a raw-ID one — and one of them (the
// invitation encoder) has already been broken once by a non-ASCII team name.

import { describe, it, expect, beforeEach } from "vitest";
import { HTTPError } from "@calimero-network/mero-js";
import { clampText, escapeCss, escapeHtml, MAX_COMMENT_LEN } from "./sanitize";
import { truncateMiddle } from "./format";
import { getStoredTeamName, setStoredTeamName, teamLabel } from "./teamName";
import { extractErrorMessage, humanizeError } from "./errorMessage";
import {
  decodeInvitation, decodeInvitationObject, encodeInvitation, encodeInvitationObject,
} from "./invitation";

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

describe("extractErrorMessage", () => {
  // What mero-js throws for a non-2xx answer: the node's body is kept as text
  // and its `error` field surfaces as `explanation`.
  const httpError = (body: unknown, status = 400) =>
    new HTTPError(status, "Bad Request", "http://node/admin-api/x", new Headers(), JSON.stringify(body));

  it("prefers the node's error body", () => {
    expect(extractErrorMessage(httpError({ error: "  not an admin  " }))).toBe("not an admin");
  });

  it("reads a response body's message field (an axios-shaped error)", () => {
    expect(extractErrorMessage({ response: { data: { message: "nope" } } })).toBe("nope");
  });

  it("falls back to the status line when the body says nothing", () => {
    expect(extractErrorMessage(httpError({}, 403))).toMatch(/403/);
  });

  it("reads an account admin's refusal like any other error", () => {
    expect(extractErrorMessage(new Error("deleteNamespace is not available for an account")))
      .toBe("deleteNamespace is not available for an account");
  });

  it("handles plain Errors, strings and junk", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
    expect(extractErrorMessage("  raw  ")).toBe("raw");
    expect(extractErrorMessage(null, "fallback")).toBe("fallback");
    expect(extractErrorMessage(undefined)).toBe("Something went wrong");
  });
});

describe("humanizeError", () => {
  it("translates the namespace-admin gate into something actionable", () => {
    const raw = "GroupCreated rejected: signer abc is neither an admin of namespace xyz "
      + "nor a member holding CAN_CREATE_SUBGROUP at the namespace root";
    expect(humanizeError(raw)).toContain("Ask a team admin");
  });

  it("passes anything else through untouched", () => {
    expect(humanizeError("the node is unreachable")).toBe("the node is unreachable");
  });
});

describe("invitation encoding", () => {
  it("round-trips ASCII", () => {
    expect(decodeInvitation(encodeInvitation("hello world"))).toBe("hello world");
  });

  it("round-trips non-ASCII — btoa alone throws on this", () => {
    const raw = "Équipe design 🎨 — Zürich";
    expect(decodeInvitation(encodeInvitation(raw))).toBe(raw);
  });

  it("produces a url-safe token with no padding", () => {
    const token = encodeInvitation("any string at all");
    expect(token).not.toMatch(/[+/=]/);
  });

  it("round-trips an object, which is what the invite flow actually sends", () => {
    const payload = { invitation: "signed-blob", __teamName: "Zürich 🎨" };
    expect(decodeInvitationObject(encodeInvitationObject(payload))).toEqual(payload);
  });

  it("hands back the input when a token is not decodable, rather than throwing", () => {
    expect(decodeInvitation("!!!not base64!!!")).toBe("!!!not base64!!!");
  });
});
