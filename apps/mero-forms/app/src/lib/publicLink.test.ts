import { describe, expect, it } from "vitest";
import {
  coreLabel,
  linkExpiry,
  newNonce,
  parsePublicLink,
  publicLinkUrl,
  publicRefusal,
  type LinkTarget,
} from "./publicLink";

// A core public link's token: `pl_` and 32 bytes, base64url.
const target: LinkTarget = { app: "app-7f3a", token: "pl_" + "7a".repeat(21) + "Q" };

describe("a public link", () => {
  it("carries the workspace and the link's token in the fragment only", () => {
    const url = new URL(publicLinkUrl("https://forms.example/", target));
    expect(url.origin + url.pathname).toBe("https://forms.example/f");
    expect(url.search).toBe("");
    expect(url.hash).toContain("7a7a");
    expect(parsePublicLink(url.hash)).toEqual(target);
  });

  it("refuses anything that is not a whole link", () => {
    expect(parsePublicLink("")).toBeNull();
    expect(parsePublicLink("#/form/abc/edit")).toBeNull();
    expect(parsePublicLink("#access_token=x")).toBeNull();
    expect(parsePublicLink(new URL(publicLinkUrl("https://x.example", { ...target, token: "abc" })).hash)).toBeNull();
    // A token never holds a dot: the visitor's bearer is split on them.
    expect(parsePublicLink(new URL(publicLinkUrl("https://x.example", { ...target, token: "pl_aaaaaaaa.bbbbbbbbbb" })).hash)).toBeNull();
  });

  it("expires at the same instant at core (seconds) and in the contract (ms)", () => {
    expect(linkExpiry(0, 1_700_000_000_500)).toEqual({ contract: "0" });
    expect(linkExpiry(7, 1_700_000_000_500)).toEqual({
      core: 1_700_000_000 + 7 * 86_400,
      contract: String((1_700_000_000 + 7 * 86_400) * 1000),
    });
  });

  it("is labelled at core by its form, in one line of at most 64 characters", () => {
    expect(coreLabel("Contact us", " newsletter ")).toBe("Forms · Contact us · newsletter");
    expect(coreLabel("Contact us", "")).toBe("Forms · Contact us");
    expect(coreLabel("x".repeat(100), "y").length).toBe(64);
    expect(coreLabel("a\nb", "")).toBe("Forms · a b");
  });
});

describe("a captcha nonce", () => {
  it("is 16 random bytes in hex, new each time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe("what a visitor is told", () => {
  it("names a dead link, a paused or closed form, the cap and the captcha plainly", () => {
    expect(publicRefusal(Object.assign(new Error("unauthorized"), { status: 401 }))).toMatch(/no longer works/);
    expect(publicRefusal(Object.assign(new Error("not public"), { status: 403 }))).toMatch(/no longer works/);
    expect(publicRefusal(Object.assign(new Error("too many"), { status: 429 }))).toMatch(/Wait a minute/);
    expect(publicRefusal(new Error("this link no longer works"))).toMatch(/no longer works/);
    expect(publicRefusal(new Error("this form is not taking responses from links"))).toMatch(/not taking responses/);
    expect(publicRefusal(new Error("this form is closed"))).toMatch(/closed/);
    expect(publicRefusal(new Error("this link has taken as many responses as it may this hour"))).toMatch(/last hour/);
    expect(publicRefusal(new Error("this captcha was already used; solve it again"))).toMatch(/human check/);
    expect(publicRefusal(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });
});
