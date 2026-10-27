/**
 * The join path an opened invitation link drives: read the token, join once,
 * and decide from the node's answer whether the invitation is finished with
 * (acked) or kept for another attempt, and what the prompt says.
 *
 * `useInviteRedemption` runs exactly this — `parseInviteToken`, then
 * `redeemInvitation` over `inviteRedeemer` — once the person accepts.
 */
import { describe, expect, it, vi } from "vitest";
import {
  describeInviteFailure,
  redeemInvitation,
  shouldRetain,
  type RedeemOutcome,
} from "@calimero-apps/cloud";
import { encodeInvitation } from "./invitation";
import {
  inviteRedeemer,
  parseInviteToken,
  type InviteAdmin,
} from "./redeemInvite";

const NS_ID =
  "20150f8a24c5cd0569743966240da01966b91d85e1c1e3a535ba3de98b864f59";
const NS_BYTES = NS_ID.match(/../g)!.map((h) => parseInt(h, 16));

const SIGNED = {
  invitation: {
    inviter_identity: Array.from({ length: 32 }, (_, i) => i),
    group_id: NS_BYTES,
    expiration_timestamp: 1786000000000,
    secret_salt: Array.from({ length: 16 }, (_, i) => 255 - i),
    invited_role: 1,
    admitters: ["aa".repeat(32)],
  },
  inviter_signature: "ab".repeat(64),
};

const CODE = encodeInvitation({
  invitation: SIGNED,
  groupAlias: "Platform team",
  kind: "namespace",
});

/** An error shaped like mero-js's `HTTPError`. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function fakeAdmin(opts: { joinError?: unknown; listed?: string[] }) {
  const joinNamespace = vi.fn(async () => {
    if (opts.joinError) throw opts.joinError;
    return { namespaceId: NS_ID };
  });
  const listNamespaces = vi.fn(async () =>
    (opts.listed ?? []).map((namespaceId) => ({ namespaceId })),
  );
  return {
    admin: { joinNamespace, listNamespaces } as unknown as InviteAdmin,
    joinNamespace,
    listNamespaces,
  };
}

async function redeemInviteCode(
  token: string,
  admin: InviteAdmin,
): Promise<RedeemOutcome> {
  const parsed = parseInviteToken(token);
  if (!parsed) throw new Error("unreadable token");
  return redeemInvitation(parsed, inviteRedeemer(admin));
}

/** What the prompt shows for a failure (see mero-react's `InvitationDialog`). */
function inviteFailureCopy(
  outcome: Extract<RedeemOutcome, { status: "failed" }>,
): string {
  return describeInviteFailure(outcome.reason, "workspace") ?? outcome.message;
}

describe("parseInviteToken", () => {
  it("names the workspace before anything is joined, so the prompt can ask", () => {
    expect(parseInviteToken(CODE)).toEqual({
      namespaceId: NS_ID,
      invitation: { invitation: SIGNED, groupName: "Platform team" },
      teamName: "Platform team",
    });
  });

  it("reads nothing out of a token that is not an invitation", () => {
    expect(parseInviteToken("not an invite")).toBeNull();
    expect(parseInviteToken(encodeInvitation({ hello: "world" }))).toBeNull();
  });
});

describe("redeeming an opened link", () => {
  it("joins the namespace named inside the signed invitation, with its name", async () => {
    const { admin, joinNamespace } = fakeAdmin({ listed: [NS_ID] });
    const outcome = await redeemInviteCode(CODE, admin);

    expect(outcome).toEqual({
      status: "joined",
      namespaceId: NS_ID,
      teamName: "Platform team",
    });
    expect(joinNamespace).toHaveBeenCalledTimes(1);
    expect(joinNamespace).toHaveBeenCalledWith(NS_ID, {
      invitation: SIGNED,
      groupName: "Platform team",
    });
    expect(shouldRetain(outcome)).toBe(false);
  });

  it("is already-member when the join errors but the node lists the workspace", async () => {
    // The desktop proxy aborting a slow join that landed anyway.
    const { admin, joinNamespace } = fakeAdmin({
      joinError: new Error("The operation was aborted."),
      listed: [NS_ID],
    });
    const outcome = await redeemInviteCode(CODE, admin);

    expect(outcome.status).toBe("already-member");
    expect(outcome.namespaceId).toBe(NS_ID);
    // Sent once, never retried on the client.
    expect(joinNamespace).toHaveBeenCalledTimes(1);
    expect(shouldRetain(outcome)).toBe(false);
  });

  it("acks a final failure (409), offers no retry, and says why in plain words", async () => {
    const { admin } = fakeAdmin({
      joinError: httpError(
        409,
        `invitation for group ${NS_ID} expired at 1786000000`,
      ),
    });
    const outcome = await redeemInviteCode(CODE, admin);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(false);
    expect(shouldRetain(outcome)).toBe(false);
    expect(inviteFailureCopy(outcome)).toBe(
      "This invitation has expired. Ask for a new link.",
    );
  });

  it("names the workspace when a 409 says nothing more specific", async () => {
    const { admin } = fakeAdmin({ joinError: httpError(409, "Conflict") });
    const outcome = await redeemInviteCode(CODE, admin);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(shouldRetain(outcome)).toBe(false);
    expect(inviteFailureCopy(outcome)).toBe(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
  });

  it("keeps the invitation on a transient failure (503) and offers a retry", async () => {
    const { admin } = fakeAdmin({
      joinError: httpError(503, "Service Unavailable"),
    });
    const outcome = await redeemInviteCode(CODE, admin);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(true);
    expect(shouldRetain(outcome)).toBe(true);
    expect(inviteFailureCopy(outcome)).toBe(
      "No one in this workspace is online to let you in yet. It will try again the next time you open the app.",
    );
  });

  it("shows the node message when there is nothing more specific to say", async () => {
    const { admin } = fakeAdmin({
      joinError: httpError(500, "something odd happened"),
    });
    const outcome = await redeemInviteCode(CODE, admin);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(inviteFailureCopy(outcome)).toBe("something odd happened");
  });
});
