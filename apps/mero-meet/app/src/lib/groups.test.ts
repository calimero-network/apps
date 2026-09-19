import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeInvite } from "./inviteCodec";
import { CAPABILITIES } from "@calimero-network/mero-js";
import {
  MEMBER_CAPABILITIES,
  acceptInvite,
  createTeamNamespace,
  createRoom,
  enterRoomContext,
  listRooms,
  mintRoomInvite,
  unwrapInvitation,
  type AdminLike,
} from "./groups";

// These are the sequences a second person's whole experience depends on, and every
// one of them is several calls deep with a fallback in it. Driving them against a
// recording fake is the only way to assert the ORDER and the SHAPE of those calls —
// which is exactly where the real bugs were (a subgroup joined before its parent, a
// restricted room, "Open" instead of "open").

/**
 * Record every admin call, so tests can assert order and arguments.
 *
 * `overrides` supplies the IMPLEMENTATION and is wrapped by the recorder like any
 * other method — an override that replaced the wrapper outright would silently
 * vanish from `calls`, and an order assertion would then pass for the wrong reason.
 */
function fakeAdmin(overrides: Record<string, (...a: never[]) => unknown> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec =
    (method: string, impl?: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      const run = (overrides[method] ?? impl) as
        ((...a: unknown[]) => unknown) | undefined;
      return Promise.resolve(run ? run(...args) : undefined);
    };
  const admin = {
    calls,
    createNamespace: rec("createNamespace", () => ({ namespaceId: "ns1" })),
    setDefaultCapabilities: rec("setDefaultCapabilities"),
    setSubgroupVisibility: rec("setSubgroupVisibility"),
    createGroupInNamespace: rec("createGroupInNamespace", () => ({
      groupId: "room1",
    })),
    createContext: rec("createContext", () => ({
      contextId: "ctx1",
      memberPublicKey: "pk-creator",
    })),
    createNamespaceInvitation: rec("createNamespaceInvitation"),
    createGroupInvitation: rec("createGroupInvitation"),
    joinNamespace: rec("joinNamespace"),
    joinGroup: rec("joinGroup"),
    joinSubgroupInheritance: rec("joinSubgroupInheritance"),
    syncGroup: rec("syncGroup"),
    getSubgroupVisibility: rec("getSubgroupVisibility", () => undefined),
    joinContext: rec("joinContext", () => ({ memberPublicKey: "pk-joined" })),
    getContextIdentitiesOwned: rec("getContextIdentitiesOwned", () => ({
      identities: [],
    })),
    listNamespaces: rec("listNamespaces", () => []),
    listNamespaceGroups: rec("listNamespaceGroups", () => []),
    listGroupContexts: rec("listGroupContexts", () => []),
    listGroupMembers: rec("listGroupMembers", () => ({ members: [] })),
    setGroupMetadata: rec("setGroupMetadata"),
    getGroupMetadata: rec("getGroupMetadata", () => null),
  };
  return admin as unknown as AdminLike & {
    calls: { method: string; args: unknown[] }[];
  };
}

const signed = (groupId: string) => ({
  invitation: { groupId, nonce: 1 },
  inviter_signature: `sig-${groupId}`,
});

const methodsOf = (a: { calls: { method: string }[] }) =>
  a.calls.map((c) => c.method);

afterEach(() => vi.useRealTimers());

describe("unwrapInvitation", () => {
  it("descends to the object carrying the signature", () => {
    // The join endpoints want the invitation OBJECT, not a wrapper around it —
    // the trap dev-invite.sh hit.
    const wrapped = { invitation: signed("ns1"), groupName: "Team" };
    expect(unwrapInvitation(wrapped)).toEqual(signed("ns1"));
  });

  it("tolerates the camelCase signature spelling", () => {
    const camel = { invitation: { groupId: "a" }, inviterSignature: "s" };
    expect(unwrapInvitation({ invitation: camel })).toEqual(camel);
  });

  it("returns null when nothing in the chain is signed", () => {
    expect(unwrapInvitation({ invitation: { invitation: {} } })).toBeNull();
    expect(unwrapInvitation(null)).toBeNull();
  });
});

describe("createRoom", () => {
  it("creates the subgroup, names it, opens it, THEN creates the context", async () => {
    const admin = fakeAdmin();
    const out = await createRoom(admin, {
      applicationId: "app1",
      namespaceId: "ns1",
      name: "Standup",
    });

    // The metadata write is not redundant with `createGroupInNamespace({name})`:
    // that name does not persist on rc.19 (the listing returns a bare `{groupId}`
    // and the metadata record is null), so without it every room renders as
    // "Room 69aab2".
    expect(methodsOf(admin)).toEqual([
      "createGroupInNamespace",
      "setGroupMetadata",
      "setSubgroupVisibility",
      "createContext",
    ]);
    expect(
      admin.calls.find((c) => c.method === "setGroupMetadata")!.args[1],
    ).toEqual({ name: "Standup" });
    expect(out).toEqual({
      roomId: "room1",
      contextId: "ctx1",
      memberPublicKey: "pk-creator",
    });
  });

  it('sets visibility to LOWERCASE open — core rejects "Open"', () => {
    // mero-js types this as a bare `string`, so nothing catches the casing at
    // compile time; the node's error is the only signal, and it comes at runtime.
    const admin = fakeAdmin();
    return createRoom(admin, {
      applicationId: "app1",
      namespaceId: "ns1",
      name: "Standup",
    }).then(() => {
      const call = admin.calls.find(
        (c) => c.method === "setSubgroupVisibility",
      );
      expect(call!.args[1]).toEqual({ subgroupVisibility: "open" });
    });
  });

  it("binds the context to the SUBGROUP, not the namespace", async () => {
    const admin = fakeAdmin();
    await createRoom(admin, {
      applicationId: "app1",
      namespaceId: "ns1",
      name: "Standup",
    });
    const ctx = admin.calls.find((c) => c.method === "createContext")!;
    expect((ctx.args[0] as { groupId: string }).groupId).toBe("room1");
  });

  it("FAILS if the room cannot be opened, rather than making a restricted room", async () => {
    // A restricted room is unreachable by the members invited to the namespace
    // (403 from join-via-inheritance) and there is no sign of it until someone
    // tries to join. Failing here is the only place the cause can be named.
    const admin = fakeAdmin({
      setSubgroupVisibility: () => Promise.reject(new Error("nope")),
    });
    await expect(
      createRoom(admin, {
        applicationId: "app1",
        namespaceId: "ns1",
        name: "Standup",
      }),
    ).rejects.toThrow("nope");
    expect(methodsOf(admin)).not.toContain("createContext");
  });

  it("reports each step so the UI can show progress, not just a spinner", async () => {
    const seen: string[] = [];
    await createRoom(
      fakeAdmin(),
      { applicationId: "app1", namespaceId: "ns1", name: "Standup" },
      (m) => seen.push(m),
    );
    expect(seen.length).toBe(4);
  });
});

describe("mintRoomInvite", () => {
  it("grants the NAMESPACE and carries the room only as a routing hint", async () => {
    // Room access is INHERITED, so the namespace grant is what makes a room
    // reachable — there is no narrower invitation to mint. Two APIs were tried and
    // do not work on rc.19: `recursive: true` on a subgroup is ignored, and a bare
    // subgroup invitation is refused for anyone not already holding the parent.
    const admin = fakeAdmin({
      createNamespaceInvitation: () =>
        Promise.resolve({ invitation: signed("ns1") }),
    });

    const decoded = decodeInvite(
      await mintRoomInvite(admin, {
        namespaceId: "ns1",
        roomId: "room1",
        roomName: "Standup",
        namespaceName: "Team",
        contextId: "ctx1",
      }),
    )!;

    expect(methodsOf(admin)).toEqual(["createNamespaceInvitation"]);
    expect(decoded.kind).toBe("room");
    // The GRANT is the namespace…
    expect(decoded.invitation.inviter_signature).toBe("sig-ns1");
    expect(decoded.groupId).toBe("ns1");
    // …and the room/context are navigation only.
    expect(decoded.roomId).toBe("room1");
    expect(decoded.contextId).toBe("ctx1");
    expect(decoded.roomName).toBe("Standup");
  });

  it("throws when the node returns no signed invitation", async () => {
    const admin = fakeAdmin({
      createNamespaceInvitation: () => Promise.resolve({ nothing: true }),
    });
    await expect(
      mintRoomInvite(admin, { namespaceId: "ns1", roomId: "room1" }),
    ).rejects.toThrow(/signature/i);
  });
});

describe("acceptInvite", () => {
  it("joins the NAMESPACE for a room code, and keeps the room as routing", async () => {
    // This is the shape mintRoomInvite actually produces on rc.19. Getting it
    // wrong is what made the first attempt fail: it called joinGroup with a
    // namespace-scoped invitation and node2 never reached the call.
    const admin = fakeAdmin();
    const out = await acceptInvite(admin, {
      invitation: signed("ns1"),
      kind: "room",
      groupId: "ns1",
      roomId: "room1",
      contextId: "ctx1",
    });
    expect(methodsOf(admin)).toEqual(["joinNamespace"]);
    expect(admin.calls[0].args[0]).toBe("ns1");
    expect(out).toMatchObject({
      namespaceId: "ns1",
      roomId: "room1",
      contextId: "ctx1",
    });
  });

  it("walks a chain parent-first: joinNamespace THEN joinGroup", async () => {
    const admin = fakeAdmin();
    const out = await acceptInvite(admin, {
      invitation: signed("room1"),
      kind: "room",
      groupId: "room1",
      contextId: "ctx1",
      chain: [
        { groupId: "ns1", invitation: signed("ns1"), kind: "namespace" },
        { groupId: "room1", invitation: signed("room1"), kind: "room" },
      ],
    });

    expect(methodsOf(admin)).toEqual(["joinNamespace", "joinGroup"]);
    expect(admin.calls[0].args[0]).toBe("ns1");
    expect(out).toMatchObject({
      namespaceId: "ns1",
      roomId: "room1",
      contextId: "ctx1",
    });
  });

  it("treats a code with no `kind` as a namespace invite (pre-rooms codes)", async () => {
    const admin = fakeAdmin();
    const out = await acceptInvite(admin, { invitation: signed("ns1") });
    expect(methodsOf(admin)).toEqual(["joinNamespace"]);
    expect(out.namespaceId).toBe("ns1");
    expect(out.roomId).toBeNull();
  });

  it("acts on the id INSIDE the signed invitation, not the wrapper", async () => {
    // A tampered wrapper must not be able to redirect the join.
    const admin = fakeAdmin();
    await acceptInvite(admin, {
      invitation: signed("ns-real"),
      groupId: "ns-attacker",
    });
    expect(admin.calls[0].args[0]).toBe("ns-real");
  });

  it("treats an already-satisfied join as success", async () => {
    // Re-pasting a code, or a chain overlapping memberships already held, must end
    // with the user in the room — not staring at "already a member" as an error.
    const admin = fakeAdmin({
      joinNamespace: () =>
        Promise.reject(new Error("Already a member of group")),
    });
    const out = await acceptInvite(admin, { invitation: signed("ns1") });
    expect(out.namespaceId).toBe("ns1");
  });

  it("propagates a real join failure", async () => {
    const admin = fakeAdmin({
      joinNamespace: () => Promise.reject(new Error("invitation expired")),
    });
    await expect(
      acceptInvite(admin, { invitation: signed("ns1") }),
    ).rejects.toThrow("invitation expired");
  });

  it("discovers the parent namespace for a subgroup-only chain", async () => {
    // Reachable only for a node that mints a real subgroup invitation (rc.19 does
    // not). There is no "parent of" read in the admin API and the wrapper's claim
    // is unsigned, so ask which namespace actually holds the room — otherwise
    // there is nowhere to navigate after the join.
    const admin = fakeAdmin({
      listNamespaces: () => Promise.resolve([{ namespaceId: "nsX" }]),
      listNamespaceGroups: () => Promise.resolve([{ groupId: "room1" }]),
    });
    const out = await acceptInvite(admin, {
      invitation: signed("room1"),
      kind: "room",
      chain: [{ groupId: "room1", invitation: signed("room1"), kind: "room" }],
    });
    expect(methodsOf(admin)).toContain("joinGroup");
    expect(out.roomId).toBe("room1");
    expect(out.namespaceId).toBe("nsX");
  });
});

describe("enterRoomContext", () => {
  it("returns the existing identity without joining anything", async () => {
    // Opening a room you are already in must not touch the network beyond the
    // check — it is the common case and it has to feel instant.
    const admin = fakeAdmin({
      getContextIdentitiesOwned: () =>
        Promise.resolve({ identities: ["pk-mine"] }),
    });
    expect(
      await enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" }),
    ).toBe("pk-mine");
    expect(methodsOf(admin)).toEqual(["getContextIdentitiesOwned"]);
  });

  it("self-admits into the open subgroup, then waits for the identity", async () => {
    // The step whose absence made rooms unreachable: joining a NAMESPACE does not
    // put you in its ROOMS.
    vi.useFakeTimers();
    let looks = 0;
    const admin = fakeAdmin({
      getContextIdentitiesOwned: () =>
        Promise.resolve({ identities: ++looks >= 3 ? ["pk-late"] : [] }),
    });
    const p = enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toBe("pk-late");
    expect(methodsOf(admin)).toContain("joinSubgroupInheritance");
    expect(methodsOf(admin)).not.toContain("joinContext");
  });

  it("falls back to joinContext when auto-follow never lands it", async () => {
    // Auto-follow carries the context identity but is neither instant nor
    // guaranteed — dev-invite.sh and suite S4 both need this same fallback.
    vi.useFakeTimers();
    const admin = fakeAdmin();
    const p = enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" });
    await vi.advanceTimersByTimeAsync(70_000);
    await expect(p).resolves.toBe("pk-joined");
    expect(methodsOf(admin)).toContain("joinContext");
  });

  it("retries a 403 rather than declaring the room restricted", async () => {
    // A 403 is NOT proof of restriction. Inheritance is checked against the
    // namespace membership as this node has PROJECTED it, and on a cold join
    // that projection lands a moment after the join returns — which is exactly
    // the window the redeem path runs in. Verified on two live nodes: the same
    // sequence is admitted once the membership has projected, with the room's
    // open/restricted setting unchanged throughout.
    vi.useFakeTimers();
    let attempts = 0;
    let admitted = false;
    const admin = fakeAdmin({
      joinSubgroupInheritance: () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(
            new Error(
              "403 Forbidden: identity not eligible for inheritance-based join",
            ),
          );
        }
        admitted = true;
        return Promise.resolve(undefined as never);
      },
      // Auto-follow lands the context identity once we are actually in.
      getContextIdentitiesOwned: () =>
        Promise.resolve({ identities: admitted ? ["pk-admitted"] : [] }),
    });
    const p = enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe("pk-admitted");
    expect(attempts).toBe(3);
  });

  /** Exhaust the admission window with a permanent 403 and return the message. */
  async function refusedMessage(
    over: Record<string, unknown>,
  ): Promise<string> {
    vi.useFakeTimers();
    const admin = fakeAdmin({
      joinSubgroupInheritance: () =>
        Promise.reject(new Error("403 Forbidden: identity not eligible")),
      ...over,
    });
    const p = enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" });
    // Keep the rejection from going unhandled while the fake clock runs.
    const captured = p.catch((e: unknown) =>
      e instanceof Error ? e.message : String(e),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    return captured;
  }

  it("says so plainly when the room really is restricted", async () => {
    const msg = await refusedMessage({
      getSubgroupVisibility: () => Promise.resolve("restricted"),
    });
    expect(msg).toMatch(/RESTRICTED/);
    // And does not send the user off to wait for something that will not come.
    expect(msg).not.toMatch(/try again in a moment/i);
  });

  it("blames replication, not visibility, when the room is open", async () => {
    // The old message asserted "probably created as restricted" for every 403,
    // which sent people to check a setting that was correct.
    const msg = await refusedMessage({
      getSubgroupVisibility: () => Promise.resolve("open"),
      listNamespaces: () => Promise.resolve([{ namespaceId: "ns1" }]),
      listNamespaceGroups: () => Promise.resolve([{ groupId: "room1" }]),
    });
    expect(msg).toMatch(/not having reached this node yet|has not reached/i);
    expect(msg).not.toMatch(/RESTRICTED/);
  });

  it("names both causes when it cannot read the visibility", async () => {
    const msg = await refusedMessage({
      getSubgroupVisibility: () => Promise.reject(new Error("nope")),
      listNamespaces: () => Promise.resolve([{ namespaceId: "ns1" }]),
      listNamespaceGroups: () => Promise.resolve([{ groupId: "room1" }]),
    });
    expect(msg).toMatch(/not reached this node yet/i);
    expect(msg).toMatch(/restricted/i);
  });

  it("does not retry a failure that is not an admission refusal", async () => {
    // A bad id or a shape rejection is not going to fix itself; retrying it
    // only delays the message by the length of the window.
    let attempts = 0;
    const admin = fakeAdmin({
      joinSubgroupInheritance: () => {
        attempts += 1;
        return Promise.reject(new Error("400 Bad Request: unknown field"));
      },
    });
    await expect(
      enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" }),
    ).rejects.toThrow(/400 Bad Request/);
    expect(attempts).toBe(1);
  });
});

describe("listRooms", () => {
  it("degrades a room whose context has not replicated, rather than failing the list", async () => {
    // Right after joining, a room legitimately exists with no context on this node
    // yet. Emptying the whole list for that would hide the rooms that do work.
    const admin = fakeAdmin({
      listNamespaceGroups: () =>
        Promise.resolve([
          { groupId: "r1", name: "Ready" },
          { groupId: "r2", name: "Pending" },
        ]),
      listGroupContexts: (id: unknown) =>
        id === "r1"
          ? Promise.resolve([{ contextId: "ctx1" }])
          : Promise.reject(new Error("not here yet")),
      listGroupMembers: () =>
        Promise.resolve({ members: [{ identity: "a", role: "member" }] }),
      getContextIdentitiesOwned: () =>
        Promise.resolve({ identities: ["pk-mine"] }),
    });

    const rooms = await listRooms(admin, "ns1");
    expect(rooms).toEqual([
      {
        roomId: "r1",
        name: "Ready",
        contextId: "ctx1",
        memberCount: 1,
        joined: true,
        // The identity itself, not just the fact of holding one: the room's
        // contract keys its roster by this, so it is what marks "you" in a
        // member list.
        identity: "pk-mine",
      },
      {
        roomId: "r2",
        name: "Pending",
        contextId: null,
        memberCount: 1,
        joined: false,
        identity: null,
      },
    ]);
  });
});

// ── rc.41: the namespace default mask is load-bearing ───────────────────────
//
// 0.11.0-rc.41 seeds a new namespace root with
// `CAN_JOIN_OPEN_SUBGROUPS | CAN_AUTHOR_ON_BEHALF` (core's
// `initial_default_capabilities`, #3969) and publishes it as a governance op so
// it replicates (#3974). `CAN_AUTHOR_ON_BEHALF` is "write as somebody else".
//
// This app overwrites that seed immediately. These assert the two halves of
// that being TRUE rather than merely attempted:
//
//   1. the mask we send does not contain CAN_AUTHOR_ON_BEHALF;
//   2. a node that refuses the write fails the whole call.
//
// (2) is the one worth having. The call used to end `.catch(() => {})`, which
// at rc.37 cost an invitee a capability and at rc.41 GRANTS them one, silently
// and permanently.

describe("createTeamNamespace — the rc.41 default mask", () => {
  it("never sends CAN_AUTHOR_ON_BEHALF", async () => {
    const admin = fakeAdmin();
    await createTeamNamespace(admin as unknown as AdminLike, {
      applicationId: "app-1",
      name: "Team",
    });
    const call = admin.calls.find((c) => c.method === "setDefaultCapabilities");
    const sent = (call?.args[1] as { defaultCapabilities: number })
      .defaultCapabilities;
    expect(sent & CAPABILITIES.CAN_AUTHOR_ON_BEHALF).toBe(0);
    expect(sent).toBe(MEMBER_CAPABILITIES);
  });

  it("fails the whole call when the node refuses the write", async () => {
    // Was `.catch(() => {})`. At rc.41 swallowing this leaves every invited
    // member holding CAN_AUTHOR_ON_BEHALF, with nothing reported anywhere.
    const admin = fakeAdmin({
      setDefaultCapabilities: () => Promise.reject(new Error("503")),
    });
    await expect(
      createTeamNamespace(admin as unknown as AdminLike, {
        applicationId: "app-1",
        name: "Team",
      }),
    ).rejects.toThrow("503");
  });
});
