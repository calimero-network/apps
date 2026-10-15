import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGroupContexts } from "./useGroupContexts";

const h = vi.hoisted(() => ({
  listSubgroups: vi.fn(),
  listGroupContexts: vi.fn(),
  getGroup: vi.fn(),
  listMembers: vi.fn(),
  joinGroupContext: vi.fn(),
  fetchContextIdentities: vi.fn(),
  getContextInfo: vi.fn(),
  joinChat: vi.fn(),
}));

vi.mock("../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listSubgroups = h.listSubgroups;
    listGroupContexts = h.listGroupContexts;
    getGroup = h.getGroup;
    listMembers = h.listMembers;
    joinGroupContext = h.joinGroupContext;
  },
}));

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    getContextInfo = h.getContextInfo;
    joinChat = h.joinChat;
  },
}));

vi.mock("../api/meroJsClient", () => ({
  nodeApi: { fetchContextIdentities: h.fetchContextIdentities },
}));

const GENERAL = { groupId: "sg-general", alias: "general" };

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.listGroupContexts.mockResolvedValue({
    data: [{ contextId: "ctx-general", alias: "general" }],
    error: null,
  });
  h.getGroup.mockResolvedValue({ data: { subgroupVisibility: "open" }, error: null });
  h.listMembers.mockResolvedValue({ data: { members: [], selfIdentity: "me" }, error: null });
  h.fetchContextIdentities.mockResolvedValue({ data: { data: { identities: [] } } });
  h.joinGroupContext.mockResolvedValue({
    data: { contextId: "ctx-general", memberPublicKey: "key" },
    error: null,
  });
  h.getContextInfo.mockResolvedValue({ data: { name: "general" } });
  h.joinChat.mockResolvedValue({ data: null, error: null });
});

describe("useGroupContexts: the first entry joins the workspace's public channels", () => {
  it("joins the open channels it finds on entry", async () => {
    h.listSubgroups.mockResolvedValue({ data: [GENERAL], error: null });
    const { result } = renderHook(() => useGroupContexts());
    await act(() => result.current.fetchGroupContexts("ns-a"));
    expect(h.joinGroupContext).toHaveBeenCalledWith("ns-a", { contextId: "ctx-general" });
    expect(result.current.channels.map((c) => c.isJoined)).toEqual([true]);
  });

  // Right after an invitation is accepted the node may not hold the
  // workspace's channels yet, and the first read comes back empty. The entry
  // sweep used to count that as done, so the channels that arrived a moment
  // later were never joined, the sidebar (joined channels only) stayed empty,
  // and the person saw a workspace with no data.
  it("still joins them when the first read came back before they synced", async () => {
    h.listSubgroups
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValue({ data: [GENERAL], error: null });
    const { result } = renderHook(() => useGroupContexts());
    await act(() => result.current.fetchGroupContexts("ns-b"));
    expect(h.joinGroupContext).not.toHaveBeenCalled();

    await act(() => result.current.fetchGroupContexts("ns-b"));
    expect(h.joinGroupContext).toHaveBeenCalledWith("ns-b", { contextId: "ctx-general" });
    expect(result.current.channels.map((c) => c.isJoined)).toEqual([true]);
  });

  it("leaves an open channel created after the entry sweep to Browse Channels", async () => {
    h.listSubgroups
      .mockResolvedValueOnce({ data: [GENERAL], error: null })
      .mockResolvedValue({
        data: [GENERAL, { groupId: "sg-later", alias: "later" }],
        error: null,
      });
    h.listGroupContexts.mockImplementation(async (sg: string) => ({
      data: [{ contextId: sg === "sg-later" ? "ctx-later" : "ctx-general", alias: sg }],
      error: null,
    }));
    const { result } = renderHook(() => useGroupContexts());
    await act(() => result.current.fetchGroupContexts("ns-c"));
    h.fetchContextIdentities.mockImplementation(async (ctx: string) => ({
      data: { data: { identities: ctx === "ctx-general" ? ["key"] : [] } },
    }));
    h.joinGroupContext.mockClear();

    await act(() => result.current.fetchGroupContexts("ns-c"));
    expect(h.joinGroupContext).not.toHaveBeenCalled();
  });
});
