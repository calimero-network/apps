import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDMs } from "./useDMs";
import {
  clearRegisteredContextIdentities,
} from "../utils/selfIdentity";

const {
  mockListGroupContexts,
  mockListMembers,
  mockResolveCurrentMemberIdentity,
  mockListSubgroups,
  mockGetContextInfo,
  mockGetProfiles,
  mockFetchContextIdentities,
  mockGetGroupMemberIdentity,
  mockSetGroupMemberIdentity,
} = vi.hoisted(() => ({
  mockListGroupContexts: vi.fn(),
  mockListMembers: vi.fn(),
  mockResolveCurrentMemberIdentity: vi.fn(),
  mockListSubgroups: vi.fn(),
  mockGetContextInfo: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockFetchContextIdentities: vi.fn(),
  mockGetGroupMemberIdentity: vi.fn(),
  mockSetGroupMemberIdentity: vi.fn(),
}));

vi.mock("../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    listGroupContexts = mockListGroupContexts;
    listMembers = mockListMembers;
    resolveCurrentMemberIdentity = mockResolveCurrentMemberIdentity;
    listSubgroups = mockListSubgroups;
  },
}));

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class MockClientApiDataSource {
    getContextInfo = mockGetContextInfo;
    getProfiles = mockGetProfiles;
  },
}));

vi.mock("../api/meroJsClient", () => ({
  nodeApi: {
    fetchContextIdentities: mockFetchContextIdentities,
  },
}));

vi.mock("../constants/config", () => ({
  getGroupMemberIdentity: mockGetGroupMemberIdentity,
  setGroupMemberIdentity: mockSetGroupMemberIdentity,
  // selfIdentity reads these too — the module-namespace access throws if the
  // mock omits them, which would swallow the self-check inside useDMs.
  getContextMemberIdentity: () => "",
  getGroupId: () => "",
}));

describe("useDMs (1-group-per-context)", () => {
  beforeEach(() => {
    mockListGroupContexts.mockReset();
    mockListMembers.mockReset();
    mockResolveCurrentMemberIdentity.mockReset();
    mockListSubgroups.mockReset();
    mockGetContextInfo.mockReset();
    mockGetProfiles.mockReset();
    mockFetchContextIdentities.mockReset();
    mockGetGroupMemberIdentity.mockReset();
    mockSetGroupMemberIdentity.mockReset();
    clearRegisteredContextIdentities();

    mockGetGroupMemberIdentity.mockReturnValue("member-me");
    mockListMembers.mockResolvedValue({
      data: { members: [] },
      error: null,
    });
    mockResolveCurrentMemberIdentity.mockResolvedValue({
      data: { memberIdentity: "member-me" },
      error: null,
    });
  });

  it("discovers a DM from subgroup MEMBERSHIP when there is no alias or metadata", async () => {
    // The invitee's real situation, captured from two live nodes: the subgroup
    // name was never stored (a 140-byte DM alias into a 64-byte field), and the
    // context entry arrives bare — `{ contextId }` and nothing else. Both of
    // the old discovery branches fail, so the person who did not create the DM
    // never saw it.
    //
    // Membership answers it without anything having to be named: listing a
    // restricted subgroup's members succeeds only for its members, and the
    // counterpart is the member who is not me.
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "dm-sg-1" }], // no alias — the server dropped it
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "dm-sg-1"
        ? { data: [{ contextId: "ctx-1" }], error: null } // bare, as observed
        : { data: [], error: null },
    );
    mockListMembers.mockImplementation(async (id: string) =>
      id === "dm-sg-1"
        ? {
            data: {
              members: [
                { identity: "member-me", role: "Member" },
                { identity: "member-you", role: "Admin" },
              ],
            },
            error: null,
          }
        : { data: { members: [] }, error: null },
    );
    mockFetchContextIdentities.mockRejectedValue(new Error("not joined"));

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms).toEqual([
      expect.objectContaining({ contextId: "ctx-1", otherIdentity: "member-you" }),
    ]);
  });

  it("does not offer a subgroup I am not a member of as a DM", async () => {
    // A non-member gets 403 from listMembers. Treating that as "no members" and
    // carrying on would be how someone else's conversation appears in my list.
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "not-mine" }],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "not-mine"
        ? { data: [{ contextId: "ctx-theirs" }], error: null }
        : { data: [], error: null },
    );
    mockListMembers.mockImplementation(async (id: string) =>
      id === "not-mine"
        ? { data: null, error: { code: 403, message: "node is not a member of group" } }
        : { data: { members: [] }, error: null },
    );
    mockFetchContextIdentities.mockRejectedValue(new Error("not joined"));

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms).toEqual([]);
  });

  it("prefers shared DM metadata for unjoined DM discovery", async () => {
    // Each DM lives in its own restricted subgroup with one context inside.
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "dm-sg-1", alias: "DM_CONTEXT_member-me_member-you" }],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "dm-sg-1"
        ? {
            data: [
              {
                contextId: "ctx-1",
                alias: "channel-like-alias",
                sharedContextType: "Dm",
                memberIdentities: ["member-me", "member-you"],
              },
            ],
            error: null,
          }
        : { data: [], error: null },
    );
    mockFetchContextIdentities.mockRejectedValue(new Error("not joined"));

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms).toEqual([
      expect.objectContaining({
        contextId: "ctx-1",
        otherIdentity: "member-you",
        isJoined: false,
      }),
    ]);
  });

  it("falls back to alias parsing and keeps the participant identity when profiles are missing", async () => {
    mockListSubgroups.mockResolvedValue({
      data: [
        { groupId: "dm-sg-me-you", alias: "DM_CONTEXT_member-me_member-you" },
        { groupId: "dm-sg-other", alias: "DM_CONTEXT_member-a_member-b" },
      ],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) => {
      if (id === "dm-sg-me-you") {
        return {
          data: [
            { contextId: "ctx-me-you", alias: "DM_CONTEXT_member-me_member-you" },
          ],
          error: null,
        };
      }
      if (id === "dm-sg-other") {
        return {
          data: [{ contextId: "ctx-other", alias: "DM_CONTEXT_member-a_member-b" }],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    mockFetchContextIdentities.mockImplementation(async (contextId: string) => {
      if (contextId === "ctx-me-you") {
        return { data: { data: { identities: ["member-me"] } } };
      }
      throw new Error("not joined");
    });
    mockGetContextInfo.mockResolvedValue({
      data: { name: "DM: Old", context_type: "Dm", creator: "member-me", description: JSON.stringify({ c: "Me", o: "Old" }) },
      error: null,
    });
    mockGetProfiles.mockResolvedValue({
      data: [{ identity: "member-you", username: "Stale" }],
      error: null,
    });

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    // ctx-other isn't joined and has no metadata match for member-me → filtered out.
    expect(dms).toHaveLength(1);
    expect(dms[0]).toEqual(
      expect.objectContaining({
        contextId: "ctx-me-you",
        otherAlias: "",
        otherIdentity: "member-you",
        isJoined: true,
      }),
    );
  });

  it("hides DMs whose counterpart was removed from the namespace", async () => {
    // Two DM subgroups: one with a still-present member, one with a removed
    // member. The kicked member is absent from listMembers, so the
    // corresponding DM should not appear in the returned list.
    mockListSubgroups.mockResolvedValue({
      data: [
        { groupId: "dm-sg-active", alias: "DM_CONTEXT_member-me_member-you" },
        { groupId: "dm-sg-removed", alias: "DM_CONTEXT_member-me_member-kicked" },
      ],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) => {
      if (id === "dm-sg-active") {
        return {
          data: [{ contextId: "ctx-active", alias: "DM_CONTEXT_member-me_member-you" }],
          error: null,
        };
      }
      if (id === "dm-sg-removed") {
        return {
          data: [{ contextId: "ctx-removed", alias: "DM_CONTEXT_member-me_member-kicked" }],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    // Namespace member list is authoritative — current user is present, kicked
    // user is not.
    mockListMembers.mockResolvedValue({
      data: {
        members: [
          { identity: "member-me", role: "Member" },
          { identity: "member-you", role: "Member" },
        ],
      },
      error: null,
    });
    mockFetchContextIdentities.mockResolvedValue({
      data: { data: { identities: ["member-me"] } },
    });
    mockGetContextInfo.mockResolvedValue({
      data: { name: "DM", context_type: "Dm" },
      error: null,
    });
    mockGetProfiles.mockImplementation(async (contextId: string) => {
      if (contextId === "ctx-active") {
        return {
          data: [
            { identity: "member-me", username: "Me" },
            { identity: "member-you", username: "You" },
          ],
          error: null,
        };
      }
      return {
        data: [
          { identity: "member-me", username: "Me" },
          { identity: "member-kicked", username: "Kicked" },
        ],
        error: null,
      };
    });

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms).toHaveLength(1);
    expect(dms[0]).toEqual(
      expect.objectContaining({
        contextId: "ctx-active",
        otherIdentity: "member-you",
      }),
    );
  });

  it("falls back to showing all DMs when the namespace member list is unavailable", async () => {
    // Older merods return 405 on GET /members; listMembers fails. In that
    // case we must NOT aggressively hide DMs — fall back to the legacy
    // behaviour and surface everything.
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "dm-sg-1", alias: "DM_CONTEXT_member-me_member-you" }],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "dm-sg-1"
        ? {
            data: [{ contextId: "ctx-1", alias: "DM_CONTEXT_member-me_member-you" }],
            error: null,
          }
        : { data: [], error: null },
    );
    mockListMembers.mockResolvedValue({
      data: null,
      error: { code: 405, message: "Method Not Allowed" },
    });
    mockFetchContextIdentities.mockResolvedValue({
      data: { data: { identities: ["member-me"] } },
    });
    mockGetContextInfo.mockResolvedValue({
      data: { name: "DM", context_type: "Dm" },
      error: null,
    });
    mockGetProfiles.mockResolvedValue({
      data: [
        { identity: "member-me", username: "Me" },
        { identity: "member-you", username: "You" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms).toHaveLength(1);
    expect(dms[0]).toEqual(
      expect.objectContaining({
        contextId: "ctx-1",
        otherIdentity: "member-you",
      }),
    );
  });

  it("populates namespaceMemberIdentity from subgroup alias when context entry has no alias", async () => {
    // The server may not echo the alias back on context entries. Without the
    // subgroup alias fallback, namespaceMemberIdentity would be "" and the
    // dedup check in createDM would silently fail.
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "dm-sg-1", alias: "DM_CONTEXT_member-me_member-you" }],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "dm-sg-1"
        ? {
            data: [
              {
                contextId: "ctx-1",
                // alias intentionally absent — simulates older server behaviour
              },
            ],
            error: null,
          }
        : { data: [], error: null },
    );
    mockFetchContextIdentities.mockResolvedValue({
      data: { data: { identities: ["member-me"] } },
    });
    mockGetContextInfo.mockResolvedValue({
      data: { name: "DM: You", context_type: "Dm", creator: "member-me",
              description: JSON.stringify({ c: "Me", o: "You" }) },
      error: null,
    });
    mockGetProfiles.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useDMs());
    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms).toHaveLength(1);
    expect(dms[0].namespaceMemberIdentity).toBe("member-you");
  });

  it("names the other person from the workspace member metadata only, never the DM or its profiles", async () => {
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "dm-sg-1", alias: "DM_CONTEXT_member-me_member-you" }],
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "dm-sg-1"
        ? {
            data: [
              { contextId: "ctx-me-you", alias: "DM_CONTEXT_member-me_member-you" },
            ],
            error: null,
          }
        : { data: [], error: null },
    );
    mockListMembers.mockResolvedValue({
      data: {
        members: [
          { identity: "member-me", role: "Member" },
          { identity: "member-you", alias: "Taylor", role: "Member" },
        ],
      },
      error: null,
    });
    mockFetchContextIdentities.mockResolvedValue({
      data: { data: { identities: ["member-me"] } },
    });
    mockGetContextInfo.mockResolvedValue({
      data: { name: "DM: Old", context_type: "Dm", creator: "member-me", description: JSON.stringify({ c: "Me", o: "Old" }) },
      error: null,
    });
    mockGetProfiles.mockResolvedValue({
      data: [{ identity: "member-you", username: "Stale" }],
      error: null,
    });

    const { result } = renderHook(() => useDMs());

    let dms: Awaited<ReturnType<typeof result.current.fetchDms>> = [];
    await act(async () => {
      dms = await result.current.fetchDms("namespace-1");
    });

    expect(dms[0]).toEqual(
      expect.objectContaining({
        otherAlias: "Taylor",
        otherIdentity: "member-you",
      }),
    );
    expect(dms[0]).not.toHaveProperty("otherUsername");
    expect(mockGetProfiles).not.toHaveBeenCalled();
  });
});
