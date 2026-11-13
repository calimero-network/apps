import { describe, expect, it, vi } from "vitest";
import {
  buildDmAlias,
  createDmContextInGroup,
  getDmDisplayName,
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
    // 64-byte cap. The create still returned 200 — the name was stored as the
    // empty string — so the DM existed and was never visible, which looked like
    // a button that did nothing.
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
    const result = await createDmContextInGroup({
      applicationId: "app-1",
      groupId: "namespace-1",
      myIdentity: "member-b",
      otherIdentity: "member-a",
      contextApi: {
        createGroupContext,
      },
      groupApi: {
        createSubgroup,
        setSubgroupVisibility,
        addGroupMember,
      },
    });

    const expectedAlias = buildDmAlias("member-a", "member-b");
    expect(result.error).toBe("");
    expect(result.alias).toBe(expectedAlias);
    expect(createSubgroup).toHaveBeenCalledWith("namespace-1", {
      groupName: expectedAlias,
      visibility: "restricted",
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
        initializationParams: expect.objectContaining({
          context_type: "Dm",
          name: "DM",
        }),
      }),
    );
  });

  it("writes no names: not into the DM, not into anyone's member metadata", async () => {
    const createGroupContext = vi.fn().mockResolvedValue({
      data: { contextId: "ctx-2", memberPublicKey: "member-b" },
      error: null,
    });
    const createSubgroup = vi.fn().mockResolvedValue({ data: { groupId: "dm-sg-2" }, error: null });
    const setSubgroupVisibility = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const addGroupMember = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const setMemberMetadata = vi.fn().mockResolvedValue({ data: undefined, error: null });

    await createDmContextInGroup({
      applicationId: "app-1",
      groupId: "namespace-1",
      myIdentity: "member-b",
      otherIdentity: "member-a",
      contextApi: { createGroupContext },
      groupApi: { createSubgroup, setSubgroupVisibility, addGroupMember, setMemberMetadata } as never,
    });

    const params = createGroupContext.mock.calls[0][0].initializationParams;
    expect(params.description).toBe("");
    expect(params.creator_username).toBe("");
    expect(params.name).toBe("DM");
    expect(setMemberMetadata).not.toHaveBeenCalled();
  });

  it("names a DM after the other person's workspace name, else a truncated account", () => {
    expect(getDmDisplayName({ contextId: "ctx-1", otherAlias: "Alice", otherIdentity: "member-a" })).toBe("Alice");
    expect(getDmDisplayName({ contextId: "ctx-1", otherAlias: "", otherIdentity: "member-a" })).toBe("memb…er-a");
    expect(getDmDisplayName({ contextId: "ctx-1234567" })).toBe("ctx-1234");
  });
});
