import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { deflateSync } from "fflate";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  type StreamInvitePayload,
} from "./inviteCodec";

// The invite code is the only thing a second person has to carry, so it gets the
// same scrutiny as the codec. Everything here is a pure function — no node needed.

const signed = {
  invitation: { groupId: [0xab, 0x01, 0x0f], nonce: 7 },
  inviter_signature: "sig-abc",
};
const payload: StreamInvitePayload = {
  invitation: signed,
  groupAlias: "Team stream",
  contextId: "ctx-1",
  groupId: "ab010f",
};

describe("encodeInvite / decodeInvite", () => {
  it("round-trips a payload", () => {
    const decoded = decodeInvite(encodeInvite(payload));
    expect(decoded).not.toBeNull();
    expect(decoded!.groupAlias).toBe("Team stream");
    expect(decoded!.contextId).toBe("ctx-1");
    expect(decoded!.invitation.inviter_signature).toBe("sig-abc");
  });

  it("produces a single pasteable token with no copy-hostile characters", () => {
    const code = encodeInvite(payload);
    // This is why base58 and not base64: `+`, `/` and `=` get mangled by URL
    // encoders, chat clients and shell quoting — exactly where invites travel.
    expect(code).not.toMatch(/[+/=\s"']/);
    expect(code.length).toBeGreaterThan(0);
  });

  it("compresses a REALISTIC invitation below its raw JSON", () => {
    // Sized like the real thing: a 32-byte group id as a JSON number array plus a
    // base64 signature. That array is what compresses well.
    //
    // Deliberately NOT asserted for the tiny fixture above — deflate's header plus
    // base58's ~1.37x expansion makes short payloads longer, which is fine because
    // no real invitation is that short.
    const realistic: StreamInvitePayload = {
      invitation: {
        invitation: {
          groupId: Array.from({ length: 32 }, (_, i) => (i * 7) % 256),
          nonce: 1234567,
          expiresAt: 1785854871715,
        },
        inviter_signature: "A".repeat(88),
      },
      groupAlias: "Team stream",
    };
    const raw = JSON.stringify(realistic);
    expect(encodeInvite(realistic).length).toBeLessThan(raw.length);
  });

  it("accepts the uncompressed base58 form (curb-era codes)", () => {
    const legacy = bs58.encode(
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    expect(decodeInvite(legacy)?.contextId).toBe("ctx-1");
  });

  it("accepts raw JSON, for pasting an API response straight in", () => {
    expect(decodeInvite(JSON.stringify(payload))?.groupAlias).toBe(
      "Team stream",
    );
  });

  it("unwraps an admin-api {data:…} envelope", () => {
    expect(decodeInvite(JSON.stringify({ data: payload }))?.contextId).toBe(
      "ctx-1",
    );
  });

  it("accepts a BARE SignedGroupOpenInvitation (what the API returns)", () => {
    const decoded = decodeInvite(JSON.stringify(signed));
    expect(decoded).not.toBeNull();
    expect(decoded!.invitation.inviter_signature).toBe("sig-abc");
  });

  it("tolerates the camelCase signature spelling", () => {
    const camel = { invitation: { groupId: [1] }, inviterSignature: "s" };
    expect(decodeInvite(JSON.stringify(camel))).not.toBeNull();
  });

  // Returning null rather than throwing is the contract: every caller wants
  // "that code is not valid", not an exception out of a paste handler.
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["not base58", "!!!not-a-code!!!"],
    ["base58 of garbage", bs58.encode(new TextEncoder().encode("hello"))],
    ["json without an invitation", JSON.stringify({ foo: 1 })],
    ["invitation with no signature", JSON.stringify({ invitation: {} })],
    [
      "deflated non-JSON",
      bs58.encode(deflateSync(new TextEncoder().encode("nope"))),
    ],
  ])("returns null for %s", (_label, input) => {
    expect(decodeInvite(input)).toBeNull();
  });
});

describe("namespaceIdOfInvite", () => {
  it("hex-encodes a byte-array group id", () => {
    // Current nodes send the group id as a byte array; zero-padding matters or
    // 0x01 would render as "1" and never match a real namespace id.
    expect(namespaceIdOfInvite(payload)).toBe("ab010f");
  });

  it("passes a string group id through", () => {
    expect(
      namespaceIdOfInvite({
        invitation: {
          invitation: { group_id: "deadbeef" },
          inviter_signature: "s",
        },
      }),
    ).toBe("deadbeef");
  });

  it("reads from the SIGNED invitation, not the wrapper", () => {
    // A tampered wrapper must not be able to redirect the join: the id we act on
    // comes from inside the signed blob.
    const tampered: StreamInvitePayload = {
      ...payload,
      groupId:
        "0000000000000000000000000000000000000000000000000000000000000000",
    };
    expect(namespaceIdOfInvite(tampered)).toBe("ab010f");
  });

  it("returns empty string when there is no group id", () => {
    expect(
      namespaceIdOfInvite({
        invitation: { invitation: {}, inviter_signature: "s" },
      }),
    ).toBe("");
  });
});
