import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeInvite } from "./inviteCodec";
import {
  acceptInvite,
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

  it("names visibility as the likely cause of a 403", async () => {
    // The bare 403 gives no hint, and a restricted room is the single most likely
    // reason a room cannot be entered.
    const admin = fakeAdmin({
      joinSubgroupInheritance: () => Promise.reject(new Error("403 Forbidden")),
    });
    await expect(
      enterRoomContext(admin, { roomId: "room1", contextId: "ctx1" }),
    ).rejects.toThrow(/restricted rather than open/);
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
      },
      {
        roomId: "r2",
        name: "Pending",
        contextId: null,
        memberCount: 1,
        joined: false,
      },
    ]);
  });
});
