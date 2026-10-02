import { describe, it, expect } from "vitest";
import { invitationNamespaceId, joinWorkspace } from "./workspaceJoin";
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

describe("joinWorkspace", () => {
  it("joins the invitation's namespace and is a member as whoever this session is", async () => {
    const seen: unknown[] = [];
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, (input) => {
      seen.push(input);
      return { join: async () => {}, memberships: async () => [NS] };
    });
    expect(result).toEqual({ ok: true, groupId: NS, memberIdentity: ACCOUNT });
    expect(seen).toEqual([{ namespaceId: NS, invitation: payload(NS).invitation }]);
  });

  it("counts a namespace it already belongs to as joined", async () => {
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, () => ({
      join: async () => {
        throw new Error("already a member");
      },
      memberships: async () => [NS],
    }));
    expect(result.ok).toBe(true);
  });

  it("reports a refusal with whether it is worth retrying", async () => {
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, () => ({
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

  // The cases the app's own node redeemer was tested against, now that the
  // shared one joins on a node as well.
  const refusing = (status: number, message: string) => () => ({
    join: async () => {
      throw Object.assign(new Error(message), { status });
    },
    memberships: async () => [] as string[],
  });

  it("is a member when the join request failed but the namespace is listed", async () => {
    // The desktop proxy aborts at 30s; the join lands anyway. Sent once.
    let joins = 0;
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, () => ({
      join: async () => {
        joins += 1;
        throw Object.assign(new Error("The request was aborted"), { status: 500 });
      },
      memberships: async () => [NS],
    }));
    expect(result).toEqual({ ok: true, groupId: NS, memberIdentity: ACCOUNT });
    expect(joins).toBe(1);
  });

  it("makes a 409 final, so the invitation is acked, with the workspace's copy", async () => {
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, refusing(409, "member was removed from the group"));
    expect(result).toEqual({
      ok: false,
      message: "You can't join this workspace with this invitation. Ask an admin to invite you again.",
      retryable: false,
    });
  });

  it("keeps the invitation on a 503", async () => {
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, refusing(503, "no peer available for key delivery"));
    if (result.ok) throw new Error("expected a failure");
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/No one in this workspace is online/);
  });

  it("falls back to the node's own message when the reason is unknown", async () => {
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, refusing(500, "something odd"));
    if (result.ok) throw new Error("expected a failure");
    expect(result.message).toBe("something odd");
  });

  it("does not demote a join when the namespace list cannot be read", async () => {
    const result = await joinWorkspace(payload(NS), async () => ACCOUNT, () => ({
      join: async () => {},
      memberships: async () => {
        throw new Error("offline");
      },
    }));
    expect(result.ok).toBe(true);
  });
});
