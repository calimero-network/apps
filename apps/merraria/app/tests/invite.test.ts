import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  WorldInvitePayload,
} from "../src/net/inviteCodec";
import { shouldRetain } from "@calimero-apps/cloud";
import { acceptWorldInvite, createWorldInvite, WorldInviteError } from "../src/net/admin";
import { createWorld, joinWorld } from "../src/net/admin";
import { writeSession } from "@calimero-apps/cloud";
import { installFakeCluster, type FakeCluster } from "@calimero-apps/cloud/testing";
import { clearWorld, getSession, resetSession, updateSession } from "../src/net/session";
import { resetTransport } from "../src/net/transport";

const SIGNED = {
  invitation: {
    inviterIdentity: [1, 2],
    groupId: [0xab, 0xcd, 0x01],
    expirationTimestamp: 999,
    secretSalt: [9],
  },
  inviterSignature: "sig-base58",
};

const PAYLOAD: WorldInvitePayload = {
  invitation: SIGNED,
  groupAlias: "overworld",
  contextId: "ctx-77",
  groupId: "grp-77",
};

let cluster: FakeCluster;
const APP = "package:com.calimero.merraria";

/** Sign `account` in on the fake cluster, as this tab. */
function as(account: string) {
  cluster.signIn(account);
  writeSession({ accountId: account, sessionToken: `t-${account}`, refreshToken: "r", expiresAt: 9e9 });
  resetTransport();
}

/** Alice creates a world, enters it and mints an invite; the tab is then Bob's, outside any world. */
async function aliceInvitesBob(): Promise<{ code: string; world: Awaited<ReturnType<typeof createWorld>> }> {
  as("alice");
  const world = await createWorld(APP, "overworld", 1);
  updateSession({ contextId: world.contextId, namespaceId: world.namespaceId, groupId: world.groupId, worldName: "overworld" });
  const code = await createWorldInvite();
  as("bob");
  clearWorld();
  return { code, world };
}

beforeEach(() => {
  localStorage.clear();
  resetSession();
  resetTransport();
  cluster = installFakeCluster();
  updateSession({ kind: "node", nodeUrl: "https://cloud.example", applicationId: APP });
});
afterEach(() => {
  cluster.uninstall();
  writeSession(null);
  vi.restoreAllMocks();
});

describe("invite codec", () => {
  it("roundtrips deflate+base58", () => {
    const code = encodeInvite(PAYLOAD);
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // base58 alphabet
    expect(decodeInvite(code)).toEqual(PAYLOAD);
  });

  it("accepts raw JSON and {data:...} wrappers", () => {
    expect(decodeInvite(JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
    expect(decodeInvite(JSON.stringify({ data: PAYLOAD }))).toEqual(PAYLOAD);
  });

  it("accepts a bare curb-style signed invitation", () => {
    const decoded = decodeInvite(JSON.stringify(SIGNED));
    expect(decoded).toEqual({ invitation: SIGNED });
  });

  it("rejects garbage", () => {
    expect(decodeInvite("")).toBeNull();
    expect(decodeInvite("not an invite")).toBeNull();
    expect(decodeInvite("{}")).toBeNull();
  });

  it("extracts the namespace id from group id bytes (and string/snake forms)", () => {
    expect(namespaceIdOfInvite(PAYLOAD)).toBe("abcd01");
    const str = { invitation: { invitation: { groupId: "deadbeef" }, inviterSignature: "s" } };
    expect(namespaceIdOfInvite(str)).toBe("deadbeef");
    const snake = { invitation: { invitation: { group_id: [0x00, 0xff] }, inviterSignature: "s" } };
    expect(namespaceIdOfInvite(snake)).toBe("00ff");
  });
});

describe("an invitation from one player to another", () => {
  it("Bob joins Alice's world from her link: organization, team, app — and the session says so", async () => {
    const { code, world } = await aliceInvitesBob();
    expect(await acceptWorldInvite(code)).toBe(world.contextId);
    expect(getSession()).toMatchObject({
      contextId: world.contextId,
      namespaceId: world.namespaceId,
      groupId: world.groupId,
      worldName: "overworld", // the alias travels with the invite
      executorPublicKey: "bob", // the contract's caller is Bob's account
    });
    expect(cluster.orgs.get(world.namespaceId)!.members.get("bob")).toBe("member");
  });

  it("is already a member when the join failed but the organization lists Bob", async () => {
    const { code, world } = await aliceInvitesBob();
    cluster.orgs.get(world.namespaceId)!.members.set("bob", "member");
    cluster.failNext("invites/", 503, "busy");
    expect(await acceptWorldInvite(code)).toBe(world.contextId);
  });

  it("gives up on an invitation the cluster refused for good (410), with friendly copy", async () => {
    const { code } = await aliceInvitesBob();
    cluster.failNext("invites/", 410, "invitation expired");
    const err = await acceptWorldInvite(code).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorldInviteError);
    const { outcome, message } = err as WorldInviteError;
    expect(outcome.reason).toBe("expired");
    expect(shouldRetain(outcome)).toBe(false); // the prompt acks the captured link
    expect(message).toBe("This invitation has expired. Ask for a new link.");
    expect(getSession().contextId).toBeNull();
  });

  it("keeps an invitation that failed for the moment (503) for the next load", async () => {
    const { code } = await aliceInvitesBob();
    cluster.failNext("invites/", 503, "the cluster is busy");
    const err = (await acceptWorldInvite(code).catch((e: unknown) => e)) as WorldInviteError;
    expect(err).toBeInstanceOf(WorldInviteError);
    expect(shouldRetain(err.outcome)).toBe(true); // the prompt leaves the link captured
    expect(getSession().contextId).toBeNull();
  });

  it("rejects invalid codes without touching the cluster", async () => {
    await expect(acceptWorldInvite("definitely not a code")).rejects.toThrow(/valid invite/);
    expect(cluster.calls).toEqual([]);
  });

  it("mints an organization invitation and pins the world's ids into the payload", async () => {
    as("alice");
    const world = await createWorld(APP, "overworld", 1);
    updateSession({ contextId: world.contextId, namespaceId: world.namespaceId, groupId: world.groupId, worldName: "overworld" });
    const payload = decodeInvite(await createWorldInvite())!;
    expect(payload.contextId).toBe(world.contextId);
    expect(payload.groupId).toBe(world.groupId);
    expect(payload.groupAlias).toBe("overworld");
    expect(namespaceIdOfInvite(payload)).toBe(world.namespaceId);
  });

  it("opens a world whose team is invite-only before minting, so invitees reach it", async () => {
    as("alice");
    const world = await createWorld(APP, "w", 1);
    const team = world.groupId.slice(world.namespaceId.length + 1);
    cluster.orgs.get(world.namespaceId)!.teams.get(team)!.join = "invite";
    updateSession({ contextId: world.contextId, namespaceId: world.namespaceId, groupId: world.groupId });
    await createWorldInvite();
    expect(cluster.orgs.get(world.namespaceId)!.teams.get(team)!.join).toBe("everyone");
  });

  it("refuses when not in a world", async () => {
    as("alice");
    await expect(createWorldInvite()).rejects.toThrow(/not in a shared world/);
  });

  it("a member who left cannot join the world without a new invite", async () => {
    as("alice");
    const world = await createWorld(APP, "w", 1);
    as("bob");
    await expect(joinWorld(world.contextId)).rejects.toThrow();
  });
});
