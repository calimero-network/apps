import { describe, expect, it, vi } from "vitest";

import { redeemInvitation, shouldRetain, type InviteRedeemer } from "./redeem";

const NS = "7d847b7afeab53bef1899496014ce7dae7cecc6e4fda9901b4bdcc706afcc807";
const PARSED = {
  namespaceId: NS,
  invitation: { group_id: NS },
  teamName: "Design",
};

function redeemer(over: Partial<InviteRedeemer> = {}): InviteRedeemer {
  return {
    join: vi.fn().mockResolvedValue(undefined),
    memberships: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

describe("redeemInvitation", () => {
  it("reports a clean join", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        memberships: vi.fn().mockResolvedValue([NS]),
      }),
    );
    expect(out).toMatchObject({
      status: "joined",
      namespaceId: NS,
      teamName: "Design",
    });
    expect(shouldRetain(out)).toBe(false);
  });

  // THE BUG. The desktop proxy aborts at 30s; a join with no member online
  // takes up to 95s and lands anyway. Reading that as a failure is what made a
  // used invitation replay on every load.
  it("reports already-member when the request failed but the node joined", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi
          .fn()
          .mockRejectedValue(new Error("timed out after 30 seconds")),
        memberships: vi.fn().mockResolvedValue([NS]),
      }),
    );
    expect(out).toMatchObject({ status: "already-member", namespaceId: NS });
    expect(shouldRetain(out)).toBe(false);
  });

  // The second half of the same bug: the membership check must never be able
  // to demote a join whose request already resolved.
  it("keeps a resolved join even when the membership check throws", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        memberships: vi.fn().mockRejectedValue(new Error("network")),
      }),
    );
    expect(out.status).toBe("joined");
  });

  it("reports a real failure, and keeps it for another attempt", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi
          .fn()
          .mockRejectedValue(new Error("could not reach any member")),
        memberships: vi.fn().mockResolvedValue([]),
      }),
    );
    expect(out).toMatchObject({ status: "failed", retryable: true });
    expect(shouldRetain(out)).toBe(true);
  });

  it("does not keep a failure that retrying cannot fix", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi.fn().mockRejectedValue(new Error("invitation has expired")),
      }),
    );
    expect(out).toMatchObject({ status: "failed", retryable: false });
    expect(shouldRetain(out)).toBe(false);
  });

  it("treats an unreadable membership list as unknown, not as absent", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi
          .fn()
          .mockRejectedValue(new Error("could not reach any member")),
        memberships: vi.fn().mockRejectedValue(new Error("network")),
      }),
    );
    // Unknown means we cannot claim membership — but it stays retryable, so the
    // invitation survives to a load where the answer is available.
    expect(out).toMatchObject({ status: "failed", retryable: true });
  });

  it("surfaces the node's own reason rather than a generic one", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi.fn().mockRejectedValue({
          response: {
            data: { error: "could not reach any member of this namespace" },
          },
        }),
      }),
    );
    expect(out).toMatchObject({
      status: "failed",
      message: "could not reach any member of this namespace",
    });
  });

  it("never sends a second join to settle an ambiguous one", async () => {
    const join = vi.fn().mockRejectedValue(new Error("timed out"));
    await redeemInvitation(
      PARSED,
      redeemer({
        join,
        memberships: vi.fn().mockResolvedValue([NS]),
      }),
    );
    expect(join).toHaveBeenCalledTimes(1);
  });
});
