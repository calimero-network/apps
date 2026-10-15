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

import {
  generateInvitationUrl,
  decodeInvitationPayload,
  APP_SLUG,
} from "./invitation";

describe("shareable invitation links", () => {
  const payload = JSON.stringify(signedInvitation);

  it("uses the com.calimero.chat package as the deep-link slug", () => {
    // The desktop resolves links by Application.package; this must match the
    // .mpk manifest `package` and the deeplinks resolver FRONTENDS key.
    expect(APP_SLUG).toBe("com.calimero.chat");
    expect(new URL(generateInvitationUrl(payload)).pathname).toBe(
      "/com.calimero.chat/join",
    );
  });

  it("generateInvitationUrl builds the one links.calimero.network link every app shares", () => {
    const url = generateInvitationUrl(payload);
    expect(url).toMatch(
      /^https:\/\/links\.calimero\.network\/com\.calimero\.chat\/join\?invitation=[^&#]+$/,
    );

    // The invitation param round-trips back to the original payload.
    const enc = new URL(url).searchParams.get("invitation");
    expect(enc).toBeTruthy();
    expect(decodeInvitationPayload(enc as string)).toBe(payload);
  });
});
