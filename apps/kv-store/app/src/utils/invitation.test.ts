import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import {
  APP_SLUG,
  decodeInvitationPayload,
  encodeInvitationPayload,
  generateInvitationDeepLink,
  generateInvitationUrl,
  isTerminalInvitationError,
  parseInvitationInput,
  parseInvitationPayload,
  serializeInvitationPayload,
  type KvInvitationPayload,
} from "./invitation";

// The invitation is passed through opaquely, so the fixture only has to be the
// right SHAPE: a signed body plus the signature, plus an unsigned bootstrap
// field. `extra_field_from_a_newer_node` is here on purpose — it stands for a
// field this client does not know about, and the round-trip test asserts it
// survives. A client that re-modelled the invitation would drop it and
// invalidate the signature.
const INVITATION = {
  invitation: {
    group_id: "0a6c060dc434cac50a0e22f504c72f1d6f2327d8d2435ec02165cfe0aabbccdd",
    inviter_identity: "5ZQtUJ3uWQrYH67nuebn688c1XWvKd8PyDHKckDbSYqE",
    expires_at: 1900000000,
  },
  inviter_signature: "z".repeat(128),
  inviter_account: "f".repeat(64),
  extra_field_from_a_newer_node: "must survive the round trip",
} as unknown as KvInvitationPayload["invitation"];

const PAYLOAD: KvInvitationPayload = {
  invitation: INVITATION,
  namespaceId: "0a6c060dc434cac50a0e22f504c72f1d6f2327d8d2435ec02165cfe0aabbccdd",
  contextId: "CwLv1UZm8TLagynFscJqNsfvGHUKbjNBbiAXQiJxfTpR",
};

describe("the payload codec", () => {
  it("round-trips", () => {
    const json = serializeInvitationPayload(PAYLOAD);
    expect(parseInvitationPayload(decodeInvitationPayload(encodeInvitationPayload(json))!))
      .toEqual(PAYLOAD);
  });

  it("compresses — a link has to fit in a chat message", () => {
    // The whole reason for deflate. A 180-char invitation base58'd raw is longer
    // than the JSON; compressed it is shorter. If this ever regresses, links get
    // long enough that clients wrap them and they stop being clickable.
    const json = serializeInvitationPayload(PAYLOAD);
    expect(encodeInvitationPayload(json).length).toBeLessThan(json.length);
  });

  it("rejects a payload missing any required field", () => {
    for (const key of ["namespaceId", "contextId"] as const) {
      expect(parseInvitationPayload(JSON.stringify({ ...PAYLOAD, [key]: "" }))).toBeNull();
    }
    // An invitation that is not the signed envelope at all.
    expect(parseInvitationPayload(JSON.stringify({ ...PAYLOAD, invitation: "a string" }))).toBeNull();
    expect(parseInvitationPayload(JSON.stringify({ ...PAYLOAD, invitation: {} }))).toBeNull();
    expect(parseInvitationPayload("not json")).toBeNull();
    expect(parseInvitationPayload("[]")).toBeNull();
  });

  it("passes unknown invitation fields through untouched", () => {
    // The signature covers the inner body, and unsigned bootstrap fields sit
    // outside it. Dropping a field this client does not recognise is how a
    // round-trip silently invalidates an invitation.
    const json = serializeInvitationPayload(PAYLOAD);
    const back = parseInvitationPayload(decodeInvitationPayload(encodeInvitationPayload(json))!);
    expect(
      (back!.invitation as unknown as Record<string, unknown>)[
        "extra_field_from_a_newer_node"
      ],
    ).toBe("must survive the round trip");
  });

  it("still decodes the older uncompressed-base58 format", () => {
    // Links already sent must keep working, which is the only reason the
    // fallback chain exists.
    const json = serializeInvitationPayload(PAYLOAD);
    const legacy = bs58.encode(new TextEncoder().encode(json));
    expect(decodeInvitationPayload(legacy)).toBe(json);
  });

  it("returns null for junk rather than throwing", () => {
    expect(decodeInvitationPayload("")).toBeNull();
    expect(decodeInvitationPayload("   ")).toBeNull();
  });
});

describe("parseInvitationInput", () => {
  it("accepts the https link it produced", () => {
    const json = serializeInvitationPayload(PAYLOAD);
    expect(parseInvitationInput(generateInvitationUrl(json))).toBe(json);
  });

  it("accepts the calimero:// link it produced", () => {
    const json = serializeInvitationPayload(PAYLOAD);
    expect(parseInvitationInput(generateInvitationDeepLink(json))).toBe(json);
  });

  it("accepts a bare encoded blob and raw JSON", () => {
    const json = serializeInvitationPayload(PAYLOAD);
    expect(parseInvitationInput(encodeInvitationPayload(json))).toBe(json);
    expect(parseInvitationInput(json)).toBe(json);
  });

  it("returns null for a link with no invitation param", () => {
    expect(parseInvitationInput("https://links.calimero.network/x/join")).toBeNull();
    expect(parseInvitationInput("")).toBeNull();
  });
});

describe("the link builders", () => {
  it("build on the package id, because the launcher matches Application.package", () => {
    const json = serializeInvitationPayload(PAYLOAD);
    // A display-name slug here produces links that resolve to no installed app
    // and are silently forgotten — the failure has no error surface at all.
    expect(APP_SLUG).toBe("com.calimero.kv-store");
    expect(generateInvitationUrl(json)).toContain(`/${APP_SLUG}/join`);
    expect(generateInvitationUrl(json).startsWith("https://")).toBe(true);
    expect(generateInvitationDeepLink(json)).toContain(`calimero://${APP_SLUG}/join`);
  });
});

describe("isTerminalInvitationError", () => {
  it("forgets an invitation only for errors that can never succeed", () => {
    for (const m of [
      "invitation expired",
      "Invalid signature",
      "malformed payload",
      "inviter is not admin",
      "revoked",
      "already a member of this namespace",
    ]) {
      expect(isTerminalInvitationError(m)).toBe(true);
    }
  });

  it("KEEPS it for transient or unrecognised errors", () => {
    // The asymmetry that matters: a dropped invitation is unrecoverable for the
    // user, a retried one costs a round trip. Anything unfamiliar must be kept.
    for (const m of [
      "no online member found",
      "request timed out",
      "fetch failed",
      "ECONNRESET",
      "something nobody has seen before",
      undefined,
      null,
      "",
    ]) {
      expect(isTerminalInvitationError(m)).toBe(false);
    }
  });
});
