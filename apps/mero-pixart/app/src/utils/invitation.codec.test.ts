import { describe, expect, it } from "vitest";

import {
  decodeInvitation,
  decodeInvitationObject,
  encodeInvitation,
  encodeInvitationObject,
  invitationLink,
} from "./invitation";

/** A realistic signed namespace invitation, as the node returns it. */
const signed = {
  invitation: {
    invitation: {
      group_id: Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256),
      inviter: Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 256),
      invitee: Array.from({ length: 32 }, (_, i) => (i * 5 + 91) % 256),
      expires_at: 1787740000000,
    },
    inviterSignature: "5".repeat(88),
    applicationId: "5GDsK2mxfao6n3rtFer85pJeBoVkj7FWRVmrhjQj6y9j",
  },
  __teamName: "Pixel Team",
};

/** base64url(JSON) — exactly what this app emitted before the switch. */
function legacyBase64url(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

describe("invitation codec", () => {
  it("round-trips an invitation object", () => {
    expect(decodeInvitationObject(encodeInvitationObject(signed))).toEqual(signed);
  });

  it("round-trips text with non-Latin1 characters", () => {
    const raw = JSON.stringify({ __teamName: "Café — 東京 🎨" });
    expect(decodeInvitation(encodeInvitation(raw))).toBe(raw);
  });

  it("still decodes the legacy base64url form, so shared links keep working", () => {
    expect(decodeInvitationObject(legacyBase64url(signed))).toEqual(signed);
  });

  it("still decodes raw JSON", () => {
    expect(decodeInvitation(JSON.stringify(signed))).toBe(JSON.stringify(signed));
  });

  it("is materially shorter than the base64url form it replaces", () => {
    const now = encodeInvitationObject(signed);
    const before = legacyBase64url(signed);
    // Measured ~470 vs ~859 characters for this payload.
    expect(now.length).toBeLessThan(before.length * 0.7);
    expect(invitationLink(now).length).toBeLessThan(600);
  });

  it("leaves an undecodable string alone rather than returning mojibake", () => {
    expect(decodeInvitation("!!! not an invitation !!!")).toBe("!!! not an invitation !!!");
  });
});
