import { describe, expect, it, vi } from "vitest";

import {
  describeInviteFailure,
  redeemInvitation,
  shouldRetain,
  type InviteRedeemer,
} from "./redeem";

/** What mero-js throws for a non-2xx answer: an Error carrying `status`. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(`HTTP ${status}: ${message}`), { status });
}

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

  it("does not keep an invitation the node refused as expired or invalid (core rc.56+)", async () => {
    const group = "ContextGroupId(Identity([12, 34, 56, 78]))";
    for (const message of [
      `invitation for group ${group} expired at 1759000000 (unix seconds)`,
      `invitation for group ${group} is invalid: it carries no application_id`,
    ]) {
      const out = await redeemInvitation(
        PARSED,
        redeemer({ join: vi.fn().mockRejectedValue(new Error(message)) }),
      );
      expect(out).toMatchObject({ status: "failed", retryable: false });
    }
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

  describe("reads the node's status (core rc.56+)", () => {
    it.each([
      [400, "a malformed invitation", "invalid"],
      [403, "node is not a member of group g", "refused"],
      [409, "invitation for group g expired at 1759000000 (unix seconds)", "expired"],
      [409, "member was removed from group g", "refused"],
      [410, "gone", "expired"],
    ] as const)(
      "a %i is final, so the invitation is dropped (%s)",
      async (status, message, reason) => {
        const out = await redeemInvitation(
          PARSED,
          redeemer({ join: vi.fn().mockRejectedValue(httpError(status, message)) }),
        );
        expect(out).toMatchObject({ status: "failed", reason, retryable: false });
        expect(shouldRetain(out)).toBe(false);
      },
    );

    it.each([
      [401, "signed-out"],
      [503, "no-one-online"],
      [504, "no-one-online"],
      [0, "node-unreachable"],
      [404, "unknown"],
      [500, "unknown"],
      [429, "unknown"],
    ] as const)(
      "a %i keeps the invitation for another attempt (%s)",
      async (status, reason) => {
        const out = await redeemInvitation(
          PARSED,
          redeemer({ join: vi.fn().mockRejectedValue(httpError(status, "no")) }),
        );
        expect(out).toMatchObject({ status: "failed", reason, retryable: true });
        expect(shouldRetain(out)).toBe(true);
      },
    );

    it("reads an axios-style response status too", async () => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({
          join: vi.fn().mockRejectedValue({
            response: { status: 403, data: { error: "not a member" } },
          }),
        }),
      );
      expect(out).toMatchObject({ reason: "refused", retryable: false });
    });

    // A node older than rc.56 answered every refusal as 500; its message is
    // still read, so an expired link is not kept forever.
    it("still recognises an old node's refusal by its message", async () => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({
          join: vi.fn().mockRejectedValue(httpError(500, "invitation expired")),
        }),
      );
      expect(out).toMatchObject({ reason: "expired", retryable: false });
    });

    it("treats a fetch that never reached the node as unreachable", async () => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({ join: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }),
      );
      expect(out).toMatchObject({ reason: "node-unreachable", retryable: true });
    });
  });
});

describe("describeInviteFailure", () => {
  it("speaks in the app's own noun", () => {
    expect(describeInviteFailure("refused", "vault")).toContain("this vault");
    expect(describeInviteFailure("no-one-online", "space")).toContain("this space");
  });

  it("has nothing better than the node's message for an unknown failure", () => {
    expect(describeInviteFailure("unknown")).toBeNull();
  });

  it("never offers a new link for a failure a retry can fix", () => {
    for (const reason of ["signed-out", "no-one-online", "node-unreachable"] as const) {
      expect(describeInviteFailure(reason)).not.toMatch(/new link|new one/);
    }
  });
});
