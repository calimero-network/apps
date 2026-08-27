import { describe, expect, it, vi } from "vitest";
import {
  buildDmAlias,
  createDmContextInGroup,
  getDmDisplayName,
  parseDmAlias,
  resolveSharedDmDiscovery,
} from "./dmContext";
import { MAX_GROUP_NAME_BYTES, groupNameError } from "./groupName";

describe("dmContext", () => {
  it("builds the same alias regardless of member ordering", () => {
    const first = buildDmAlias("member-b", "member-a");
    const second = buildDmAlias("member-a", "member-b");

    expect(second).toBe(first);
    expect(first.startsWith("DM_CONTEXT_")).toBe(true);
  });

  it("fits the group-name cap for real account ids", () => {
    // The bug this guards: the alias used to be
    // `DM_CONTEXT_<44-char account>_<44-char account>` = 100 bytes against a
    // 64-byte server cap, so `createSubgroup` refused it and creating a DM did
    // nothing visible at all.
    const alias = buildDmAlias(
      "D6Ey2whp8PEDj9B5Ws5KYn9KoqDLzDm214vkhEPTpYHC",
      "7Cx9dHT2ZZaaj9B5Ws5KYn9KoqDLzDm214vkhEPTpABC",
    );

    expect(new TextEncoder().encode(alias).length).toBeLessThanOrEqual(
      MAX_GROUP_NAME_BYTES,
    );
    expect(groupNameError(alias)).toBeNull();
  });

  it("does not carry either participant in the name", () => {
    // The pairing is the social graph; a group name is not where it goes.
    // Discovery reads subgroup membership instead.
    const a = "D6Ey2whp8PEDj9B5Ws5KYn9KoqDLzDm214vkhEPTpYHC";
    const b = "7Cx9dHT2ZZaaj9B5Ws5KYn9KoqDLzDm214vkhEPTpABC";
    const alias = buildDmAlias(a, b);

    expect(alias).not.toContain(a);
    expect(alias).not.toContain(b);
  });

  it("prefers shared DM metadata before alias parsing", () => {
    const discovery = resolveSharedDmDiscovery(
      {
        contextId: "ctx-1",
        alias: "not-a-dm",
        sharedContextType: "Dm",
        memberIdentities: ["me", "you"],
      },
      "me",
    );

    expect(discovery).toEqual({
      source: "metadata",
      memberIdentities: ["me", "you"],
      otherIdentity: "you",
    });
  });

  it("creates a restricted DM subgroup + context with the deterministic alias", async () => {
    const createGroupContext = vi.fn().mockResolvedValue({
      data: {
        contextId: "ctx-1",
        memberPublicKey: "member-a",
      },
      error: null,
    });
    const createSubgroup = vi.fn().mockResolvedValue({
      data: { groupId: "dm-sg-1" },
      error: null,
    });
    const setSubgroupVisibility = vi.fn().mockResolvedValue({
      data: undefined,
      error: null,
    });
    const addGroupMember = vi.fn().mockResolvedValue({
      data: undefined,
      error: null,
    });
    const setMemberMetadata = vi.fn().mockResolvedValue({ data: undefined, error: null });

    const result = await createDmContextInGroup({
      applicationId: "app-1",
      groupId: "namespace-1",
      myIdentity: "member-b",
      otherIdentity: "member-a",
      otherUsername: "Alice",
      contextApi: {
        createGroupContext,
      },
      groupApi: {
        createSubgroup,
        setSubgroupVisibility,
        addGroupMember,
        setMemberMetadata,
      },
    });

    const expectedAlias = buildDmAlias("member-a", "member-b");
    expect(result.error).toBe("");
    expect(result.alias).toBe(expectedAlias);
    expect(createSubgroup).toHaveBeenCalledWith("namespace-1", {
      groupName: expectedAlias,
    });
    // The name it sends must be one the server will accept.
    expect(groupNameError(expectedAlias)).toBeNull();
    expect(setSubgroupVisibility).toHaveBeenCalledWith("dm-sg-1", {
      subgroupVisibility: "restricted",
    });
    expect(addGroupMember).toHaveBeenCalledWith("dm-sg-1", "member-a");
    expect(createGroupContext).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "dm-sg-1",
        alias: buildDmAlias("member-a", "member-b"),
        initializationParams: expect.objectContaining({
          context_type: "Dm",
          name: "DM: Alice",
        }),
      }),
    );
  });

  it("encodes both participant names in the WASM description field", async () => {
    const createGroupContext = vi.fn().mockResolvedValue({
      data: { contextId: "ctx-2", memberPublicKey: "member-b" },
      error: null,
    });
    const createSubgroup = vi.fn().mockResolvedValue({
      data: { groupId: "dm-sg-2" },
      error: null,
    });
    const setSubgroupVisibility = vi.fn().mockResolvedValue({
      data: undefined,
      error: null,
    });
    const addGroupMember = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const setMemberMetadata = vi.fn().mockResolvedValue({ data: undefined, error: null });

    await createDmContextInGroup({
      applicationId: "app-1",
      groupId: "namespace-1",
      myIdentity: "member-b",
      myUsername: "Bob",
      otherIdentity: "member-a",
      otherUsername: "Alice",
      contextApi: { createGroupContext },
      groupApi: { createSubgroup, setSubgroupVisibility, addGroupMember, setMemberMetadata },
    });

    const callArgs = createGroupContext.mock.calls[0][0];
    const description = callArgs.initializationParams.description;
    const parsed = JSON.parse(description) as { c: string; o: string };
    expect(parsed.c).toBe("Bob");
    expect(parsed.o).toBe("Alice");
    expect(callArgs.initializationParams.creator_username).toBe("Bob");
  });

  it("calls setMemberMetadata with the namespace groupId, not the subgroup/context ID", async () => {
    const createGroupContext = vi.fn().mockResolvedValue({
      data: { contextId: "ctx-3", memberPublicKey: "member-b" },
      error: null,
    });
    const createSubgroup = vi.fn().mockResolvedValue({
      data: { groupId: "dm-sg-3" },
      error: null,
    });
    const setSubgroupVisibility = vi.fn().mockResolvedValue({
      data: undefined,
      error: null,
    });
    const addGroupMember = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const setMemberMetadata = vi.fn().mockResolvedValue({ data: undefined, error: null });

    await createDmContextInGroup({
      applicationId: "app-1",
      groupId: "namespace-1",
      myIdentity: "member-b",
      myUsername: "Bob",
      otherIdentity: "member-a",
      otherUsername: "Alice",
      contextApi: { createGroupContext },
      groupApi: { createSubgroup, setSubgroupVisibility, addGroupMember, setMemberMetadata },
    });

    // setMemberMetadata must be called with "namespace-1" (groupId param),
    // NOT "dm-sg-3" (the new DM subgroup) or any context ID.
    for (const call of setMemberMetadata.mock.calls) {
      expect(call[0]).toBe("namespace-1");
    }
    // Both parties should have metadata set
    const identitiesAliased = setMemberMetadata.mock.calls.map((c) => c[1]);
    expect(identitiesAliased).toContain("member-a");
    expect(identitiesAliased).toContain("member-b");
  });

  // Precedence deliberately inverted: namespace member metadata (`otherAlias`)
  // is the live, renameable, governance-replicated name and now wins.
  // `otherUsername` is a snapshot — the DM description's `{c,o}`, frozen when
  // the DM was created, or the per-context WASM profile seeded from it — so
  // preferring it meant a rename showed in the channel list and never in the
  // DM list. It stays as a fallback only because it arrives earlier, with
  // `get_info`, before governance sync delivers the member list.
  it("prefers the namespace alias, falls back to the snapshot username, then truncated identity", () => {
    expect(
      getDmDisplayName({
        contextId: "ctx-1",
        otherUsername: "Alice",
        otherAlias: "Alice Alias",
        otherIdentity: "member-a",
      }),
    ).toBe("Alice Alias");

    // The snapshot bridges the gap before the member list has synced.
    expect(
      getDmDisplayName({
        contextId: "ctx-1",
        otherUsername: "Alice",
        otherAlias: "",
        otherIdentity: "member-a",
      }),
    ).toBe("Alice");

    expect(
      getDmDisplayName({
        contextId: "ctx-1",
        otherUsername: "",
        otherAlias: "Alice Alias",
        otherIdentity: "member-a",
      }),
    ).toBe("Alice Alias");

    // Both sources empty → truncated identity (first4…last4 if len >= 8,
    // otherwise the full id). "member-a" is 8 chars so gets truncated.
    expect(
      getDmDisplayName({
        contextId: "ctx-1",
        otherUsername: "",
        otherAlias: "",
        otherIdentity: "member-a",
      }),
    ).toBe("memb…er-a");
  });
});
