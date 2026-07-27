import { describe, expect, it } from "vitest";
import {
  parseGroupInvitationPayload,
  serializeGroupInvitationPayload,
} from "./invitation";

const signedInvitation = {
  invitation: {
    inviter_identity: "admin",
    group_id: "group-1",
    expiration_height: 42,
    secret_salt: [1, 2, 3],
    protocol: "near",
    network: "testnet",
    contract_id: "contract.testnet",
  },
  inviter_signature: "signature",
};

describe("invitation utilities", () => {
  it("serializes and parses wrapped group invitations with aliases", () => {
    const payload = serializeGroupInvitationPayload({
      invitation: signedInvitation,
      groupAlias: "Product Team",
    });

    expect(parseGroupInvitationPayload(payload)).toEqual({
      invitation: signedInvitation,
      groupAlias: "Product Team",
    });
  });

  it("parses legacy raw invitation payloads without a group alias", () => {
    expect(
      parseGroupInvitationPayload(JSON.stringify(signedInvitation)),
    ).toEqual({
      invitation: signedInvitation,
    });
  });
});

import { isTerminalInvitationError } from "./invitation";

describe("isTerminalInvitationError", () => {
  it("is terminal for bad/expired/invalid invitations (safe to forget)", () => {
    for (const m of [
      "invitation expired",
      "Invalid invitation payload.",
      "invalid signature",
      "malformed invitation",
      "GroupCreated rejected: signer not admin",
    ]) {
      expect(isTerminalInvitationError(m)).toBe(true);
    }
  });

  it("is NOT terminal for transient/unknown errors (keep for retry)", () => {
    for (const m of [
      "no online member to sync from",
      "request timed out",
      "network error",
      "Failed to fetch",
      "Failed to join namespace", // generic fallback — not clearly terminal
      "",
      undefined,
      null,
    ]) {
      expect(isTerminalInvitationError(m as string)).toBe(false);
    }
  });
});
