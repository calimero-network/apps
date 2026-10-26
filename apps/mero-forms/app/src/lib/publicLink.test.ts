import { describe, expect, it } from "vitest";
import { AccessGrantError } from "./accessGrants";
import { newNonce, parsePublicLink, publicLinkUrl, publicRefusal, type LinkTarget } from "./publicLink";

const target: LinkTarget = {
  nodeUrl: "https://node.example:2428",
  contextId: "c0".repeat(32),
  token: "7a".repeat(32),
};

describe("a public link", () => {
  it("carries the node, the workspace and the grant token in the fragment only", () => {
    const url = new URL(publicLinkUrl("https://mero-forms.vercel.app/", target));
    expect(url.origin + url.pathname).toBe("https://mero-forms.vercel.app/f");
    expect(url.search).toBe("");
    expect(url.hash).toContain(target.token);
    expect(parsePublicLink(url.hash)).toEqual(target);
  });

  it("refuses anything that is not a whole link", () => {
    expect(parsePublicLink("")).toBeNull();
    expect(parsePublicLink("#/form/abc/edit")).toBeNull();
    expect(parsePublicLink("#access_token=x")).toBeNull();
    const short = new URL(publicLinkUrl("https://x.example", { ...target, token: "abc" })).hash;
    expect(parsePublicLink(short)).toBeNull();
    const notHttp = new URL(publicLinkUrl("https://x.example", { ...target, nodeUrl: "javascript:alert(1)" })).hash;
    expect(parsePublicLink(notHttp)).toBeNull();
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
    expect(publicRefusal(new AccessGrantError("this access grant is not valid for this context", 403))).toMatch(
      /no longer works/,
    );
    expect(publicRefusal(new AccessGrantError("this access grant has expired", 403))).toMatch(/no longer works/);
    expect(publicRefusal(new Error("execute failed: this link no longer works"))).toMatch(/no longer works/);
    expect(publicRefusal(new Error("this form is not taking responses from links"))).toMatch(/not taking responses/);
    expect(publicRefusal(new Error("this form is closed"))).toMatch(/closed/);
    expect(publicRefusal(new Error("this link has taken as many responses as it may this hour"))).toMatch(
      /last hour/,
    );
    expect(publicRefusal(new Error("this captcha was already used; solve it again"))).toMatch(/human check/);
    expect(publicRefusal(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });
});
