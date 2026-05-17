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
