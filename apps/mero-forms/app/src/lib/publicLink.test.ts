import { describe, expect, it } from "vitest";
import { newNonce, parsePublicLink, publicLinkUrl, publicRefusal, sha256Hex, type LinkTarget } from "./publicLink";

const target: LinkTarget = { app: "app-7f3a", token: "mk_" + "7a".repeat(24) };

describe("a public link", () => {
  it("carries the workspace and the key in the fragment only", () => {
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
  });

  it("is known to the contract by the key's SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
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
    expect(publicRefusal(new Error("this link no longer works"))).toMatch(/no longer works/);
    expect(publicRefusal(new Error("this form is not taking responses from links"))).toMatch(/not taking responses/);
    expect(publicRefusal(new Error("this form is closed"))).toMatch(/closed/);
    expect(publicRefusal(new Error("this link has taken as many responses as it may this hour"))).toMatch(/last hour/);
    expect(publicRefusal(new Error("this captcha was already used; solve it again"))).toMatch(/human check/);
    expect(publicRefusal(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });
});
