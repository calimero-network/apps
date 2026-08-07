import { describe, expect, it } from "vitest";
import {
  APP_SLUG,
  decodeInvitation,
  decodeInvitationObject,
  encodeInvitation,
  encodeInvitationObject,
  invitationLink,
  invitationTokenFrom,
  parseRoomInvitation,
} from "./invitation";

describe("invitation token encoding", () => {
  it("round-trips arbitrary UTF-8 (base64url, no padding)", () => {
    const raw = '{"name":"standup — daily ☀️"}';
    const token = encodeInvitation(raw);
    expect(token).not.toMatch(/[+/=]/);
    expect(decodeInvitation(token)).toBe(raw);
  });

  it("round-trips objects", () => {
    const obj = { a: 1, nested: { b: [1, 2, 3] }, s: "héllo" };
    expect(decodeInvitationObject(encodeInvitationObject(obj))).toEqual(obj);
  });

  it("returns malformed input unchanged instead of throwing", () => {
    expect(decodeInvitation("%%%not-base64%%%")).toBe("%%%not-base64%%%");
  });
});

describe("parseRoomInvitation", () => {
  it("extracts the namespace id from group_id bytes and keeps the signed outer struct", () => {
    const groupBytes = [0xc5, 0xe7, 0x5e, 0x01];
    const nodeInvite = {
      invitation: {
        invitation: { group_id: groupBytes, invited_role: 1 },
        inviterSignature: "sig",
        applicationId: "app",
      },
      __roomName: "Standup",
    };
    const token = encodeInvitationObject(nodeInvite);
    const parsed = parseRoomInvitation(token);
    expect(parsed.namespaceId).toBe("c5e75e01");
    expect(parsed.roomName).toBe("Standup");
    expect(parsed.signed).toEqual(nodeInvite.invitation);
  });

  it("accepts a string group id", () => {
    const token = encodeInvitationObject({
      invitation: { invitation: { group_id: "deadbeef" }, inviterSignature: "s" },
    });
    expect(parseRoomInvitation(token).namespaceId).toBe("deadbeef");
  });
});

describe("shareable invitation links", () => {
  it("wraps a token in a links.calimero.network URL keyed by the package slug", () => {
    const token = encodeInvitationObject({ invitation: { group_id: "g1" } });
    const url = new URL(invitationLink(token));
    expect(url.host).toBe("links.calimero.network");
    // The slug IS the bundle's package id — the desktop resolves the app by it,
    // and the landing page asks the registry for that package's frontend.
    expect(url.pathname).toBe(`/${APP_SLUG}/join`);
    expect(url.searchParams.get("invitation")).toBe(token);
  });

  it("reads the token back out of a link, and leaves a bare token alone", () => {
    const token = encodeInvitationObject({ invitation: { group_id: "g1" } });
    expect(invitationTokenFrom(invitationLink(token))).toBe(token);
    expect(invitationTokenFrom(`  ${token}  `)).toBe(token);
  });
});
