import { describe, expect, it, vi } from "vitest";
import {
  describeInviteFailure,
  redeemInvitation,
  shouldRetain,
} from "@calimero-apps/cloud";
import type { SignedGroupOpenInvitation } from "../api/groupApi";
import {
  encodeInvitationPayload,
  serializeGroupInvitationPayload,
} from "./invitation";
import {
  groupInvitationRedeemer,
  parseInvitationToken,
  type GroupInvitationRedeemer,
} from "./redeemInvitation";

const signed = {
  invitation: { group_id: "ns1" },
  inviter_signature: "sig",
} as unknown as SignedGroupOpenInvitation;
const payload = { invitation: signed, groupAlias: "Team" };
const token = encodeInvitationPayload(serializeGroupInvitationPayload(payload));

function redeemer(
  join: Awaited<ReturnType<GroupInvitationRedeemer["joinGroup"]>>,
  listed: string[] = [],
) {
  return {
    joinGroup: vi.fn(() => Promise.resolve(join)),
    listNamespaces: vi.fn(() =>
      Promise.resolve(listed.map((namespaceId) => ({ namespaceId }))),
    ),
  };
}

/** Redeem the link's token as the prompt does, noting the identity it answered. */
async function redeem(r: GroupInvitationRedeemer) {
  const parsed = parseInvitationToken(token);
  if (!parsed) throw new Error("the token did not parse");
  let memberIdentity = "";
  const outcome = await redeemInvitation(
    parsed,
    groupInvitationRedeemer(r, (id) => {
      memberIdentity = id;
    }),
  );
  return { outcome, memberIdentity };
}

const failure = (code: number, message: string) => ({
  data: null,
  error: { code, message },
});

describe("parseInvitationToken", () => {
  it("reads the workspace and its name out of a link's token", () => {
    expect(parseInvitationToken(token)).toEqual({
      namespaceId: "ns1",
      invitation: payload,
      teamName: "Team",
    });
  });

  it("is null for a token that is not a chat invitation", () => {
    expect(parseInvitationToken("not-an-invitation")).toBeNull();
  });
});

describe("groupInvitationRedeemer", () => {
  it("is joined on a clean join, with the identity the node answered", async () => {
    const r = redeemer({ data: { groupId: "ns1", memberIdentity: "me" } }, [
      "ns1",
    ]);
    const { outcome, memberIdentity } = await redeem(r);
    expect(outcome).toEqual({
      status: "joined",
      namespaceId: "ns1",
      teamName: "Team",
    });
    expect(memberIdentity).toBe("me");
    expect(r.joinGroup).toHaveBeenCalledTimes(1);
    expect(r.joinGroup).toHaveBeenCalledWith({
      invitation: signed,
      groupAlias: "Team",
    });
  });

  it("is already-member when the join failed but the node lists the workspace", async () => {
    // The desktop proxy aborts at 30s; the join lands anyway. Sent once.
    const r = redeemer(failure(500, "The request was aborted"), ["ns1"]);
    const { outcome, memberIdentity } = await redeem(r);
    expect(outcome.status).toBe("already-member");
    expect(shouldRetain(outcome)).toBe(false);
    expect(memberIdentity).toBe("");
    expect(r.joinGroup).toHaveBeenCalledTimes(1);
  });

  it("treats the node's 'already a member' answer as a join", async () => {
    const r = redeemer(failure(409, "Already a member of this group"));
    const { outcome } = await redeem(r);
    expect(outcome.status).toBe("joined");
  });

  it("makes a 409 final, so the invitation is acked, with the workspace's copy", async () => {
    const r = redeemer(failure(409, "member was removed from the group"));
    const { outcome } = await redeem(r);
    if (outcome.status !== "failed") throw new Error("expected a failure");
    expect(outcome.reason).toBe("refused");
    expect(shouldRetain(outcome)).toBe(false);
    expect(describeInviteFailure(outcome.reason, "workspace")).toBe(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
  });

  it("keeps the invitation on a 503", async () => {
    const r = redeemer(failure(503, "no peer available for key delivery"));
    const { outcome } = await redeem(r);
    if (outcome.status !== "failed") throw new Error("expected a failure");
    expect(outcome.reason).toBe("no-one-online");
    expect(shouldRetain(outcome)).toBe(true);
  });

  it("does not demote a join when the namespace list cannot be read", async () => {
    const r = {
      joinGroup: vi.fn(() =>
        Promise.resolve({ data: { groupId: "ns1", memberIdentity: "me" } }),
      ),
      listNamespaces: vi.fn(() => Promise.reject(new Error("offline"))),
    };
    const { outcome } = await redeem(r);
    expect(outcome.status).toBe("joined");
  });
});
