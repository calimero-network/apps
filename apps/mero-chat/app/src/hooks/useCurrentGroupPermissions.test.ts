import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolve, mockCaps } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockCaps: vi.fn(),
}));

vi.mock("../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    resolveCurrentMemberIdentity = mockResolve;
    getMemberCapabilities = mockCaps;
  },
}));

vi.mock("../constants/config", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getGroupMemberIdentity: () => "",
  setGroupMemberIdentity: vi.fn(),
}));

// Which row is "me" has its own tests; here the roster names it directly.
vi.mock("../utils/groupMemberIdentity", () => ({
  findSelfMember: ({ members, selfIdentity }: { members: Array<{ identity: string }>; selfIdentity: string }) =>
    members.find((m) => m.identity === selfIdentity),
}));

import { useCurrentGroupPermissions } from "./useCurrentGroupPermissions";

const ME = "a".repeat(64);

beforeEach(() => {
  mockResolve.mockReset();
  mockCaps.mockReset().mockResolvedValue({ data: { capabilities: 0 }, error: null });
});

describe("useCurrentGroupPermissions", () => {
  it("says the lookup failed rather than reading as a plain member", async () => {
    mockResolve.mockResolvedValue({ data: null, error: { code: 502, message: "HTTP 502" } });
    const { result } = renderHook(() => useCurrentGroupPermissions("group-1"));
    await waitFor(() => expect(result.current.error).toBe("HTTP 502"));
    expect(result.current.isAdmin).toBe(false);
  });

  it("retries on demand and clears the error once it works", async () => {
    mockResolve.mockResolvedValueOnce({ data: null, error: { code: 502, message: "HTTP 502" } });
    mockResolve.mockResolvedValue({
      data: { memberIdentity: ME, members: [{ identity: ME, role: "Admin" }] },
      error: null,
    });
    const { result } = renderHook(() => useCurrentGroupPermissions("group-1"));
    await waitFor(() => expect(result.current.error).toBe("HTTP 502"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("keeps the same object between renders while nothing changed", async () => {
    mockResolve.mockResolvedValue({
      data: { memberIdentity: ME, members: [{ identity: ME, role: "Member" }] },
      error: null,
    });
    const { result, rerender } = renderHook(() => useCurrentGroupPermissions("group-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.memberIdentity).toBe(ME));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
