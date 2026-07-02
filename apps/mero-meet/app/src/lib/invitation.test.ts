import { describe, expect, it } from "vitest";
import {
  decodeInvitation,
  decodeInvitationObject,
  encodeInvitation,
  encodeInvitationObject,
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
