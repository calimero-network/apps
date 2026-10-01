import { describe, it, expect } from "vitest";
import { invitationNamespaceId, joinAsAccount } from "./accountJoin";
import type { GroupInvitationPayload } from "./invitation";

const NS = "ab".repeat(32);
const ACCOUNT = "cd".repeat(32);

function payload(groupId: unknown): GroupInvitationPayload {
  return {
    invitation: { invitation: { group_id: groupId }, inviter_signature: "" },
  } as unknown as GroupInvitationPayload;
}

describe("invitationNamespaceId", () => {
  it("reads a byte-array group id as hex", () => {
    expect(invitationNamespaceId(payload(Array(32).fill(0xab)))).toBe(NS);
  });

  it("passes a string group id through", () => {
    expect(invitationNamespaceId(payload(NS))).toBe(NS);
  });
});

describe("joinAsAccount", () => {
  it("joins the invitation's namespace and is a member as the account", async () => {
    const seen: unknown[] = [];
    const result = await joinAsAccount(payload(NS), ACCOUNT, (input) => {
      seen.push(input);
      return { join: async () => {}, memberships: async () => [NS] };
    });
    expect(result).toEqual({ ok: true, groupId: NS, memberIdentity: ACCOUNT });
    expect(seen).toEqual([{ namespaceId: NS, invitation: payload(NS).invitation }]);
  });

  it("counts a namespace it already belongs to as joined", async () => {
    const result = await joinAsAccount(payload(NS), ACCOUNT, () => ({
      join: async () => {
        throw new Error("already a member");
      },
      memberships: async () => [NS],
    }));
    expect(result.ok).toBe(true);
  });

  it("reports a refusal with whether it is worth retrying", async () => {
    const result = await joinAsAccount(payload(NS), ACCOUNT, () => ({
      join: async () => {
        throw Object.assign(new Error("invitation expired"), { status: 400 });
      },
      memberships: async () => [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/expired/);
      expect(typeof result.retryable).toBe("boolean");
    }
  });
});
