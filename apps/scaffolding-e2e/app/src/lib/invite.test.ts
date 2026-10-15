import { describe, expect, it } from "vitest";
import { APP_SLUG, inviteLink, readInviteToken } from "./invite";

const PAYLOAD = {
  namespaceId: "ab".repeat(32),
  invitation: { invitation: { group_id: [1, 2, 3] }, inviterSignature: "sig" },
  contextId: "cd".repeat(32),
};

describe("invitation links", () => {
  it("is one https link on links.calimero.network, keyed by the package id", () => {
    const url = new URL(inviteLink(PAYLOAD));
    expect(url.host).toBe("links.calimero.network");
    expect(url.pathname).toBe(`/${APP_SLUG}/join`);
    expect([...url.searchParams.keys()]).toEqual(["invitation"]);
  });

  it("carries the namespace, the signed invitation and the context", () => {
    const token = new URL(inviteLink(PAYLOAD)).searchParams.get("invitation")!;
    expect(readInviteToken(token)).toEqual(PAYLOAD);
  });

  it("reads a link without a context as namespace-only", () => {
    const token = new URL(
      inviteLink({ ...PAYLOAD, contextId: undefined }),
    ).searchParams.get("invitation")!;
    expect(readInviteToken(token)?.contextId).toBeUndefined();
  });

  it("returns null for anything that is not one of ours", () => {
    expect(readInviteToken("")).toBeNull();
    expect(readInviteToken("not base64 at all!")).toBeNull();
    expect(
      readInviteToken(btoa(JSON.stringify({ hello: "world" }))),
    ).toBeNull();
  });
});
