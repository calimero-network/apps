import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetGroupMetadata, mockSetGroupMetadata, mockGetStoredGroupAlias } =
  vi.hoisted(() => ({
    mockGetGroupMetadata: vi.fn(),
    mockSetGroupMetadata: vi.fn(),
    mockGetStoredGroupAlias: vi.fn(),
  }));

vi.mock("../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    getGroupMetadata = mockGetGroupMetadata;
    setGroupMetadata = mockSetGroupMetadata;
  },
}));

vi.mock("../constants/config", () => ({
  getStoredGroupAlias: mockGetStoredGroupAlias,
}));

import { useWorkspaceName } from "./useWorkspaceName";

describe("useWorkspaceName", () => {
  beforeEach(() => {
    mockGetGroupMetadata.mockReset().mockResolvedValue({ data: null, error: null });
    mockSetGroupMetadata.mockReset().mockResolvedValue({ data: undefined, error: null });
    mockGetStoredGroupAlias.mockReset().mockReturnValue("");
  });

  it("shows the local name immediately, before the network answers", async () => {
    // The local alias is already in hand. Rendering a truncated id first and
    // replacing it a moment later is a visible flicker for a name that was
    // never unknown.
    mockGetStoredGroupAlias.mockReturnValue("Calimero");
    let resolveFetch: (v: unknown) => void = () => {};
    mockGetGroupMetadata.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { result } = renderHook(() => useWorkspaceName("1252d374abcdef"));

    expect(result.current).toBe("Calimero");
    resolveFetch({ data: null, error: null });
  });

  it("replaces it with the replicated name once that arrives", async () => {
    mockGetStoredGroupAlias.mockReturnValue("my old label");
    mockGetGroupMetadata.mockResolvedValue({
      data: { name: "Calimero", data: {}, updatedAt: 0, updatedBy: "x" },
      error: null,
    });

    const { result } = renderHook(() => useWorkspaceName("1252d374abcdef"));

    await waitFor(() => expect(result.current).toBe("Calimero"));
  });

  it("keeps the local name when the workspace has none", async () => {
    mockGetStoredGroupAlias.mockReturnValue("Calimero");

    const { result } = renderHook(() => useWorkspaceName("1252d374abcdef"));

    await waitFor(() => expect(mockGetGroupMetadata).toHaveBeenCalled());
    expect(result.current).toBe("Calimero");
  });

  it("promotes a local-only name so everyone else sees it", async () => {
    mockGetStoredGroupAlias.mockReturnValue("Calimero");

    renderHook(() => useWorkspaceName("g1"));

    await waitFor(() =>
      expect(mockSetGroupMetadata).toHaveBeenCalledWith("g1", "Calimero"),
    );
  });

  it("does not promote when the workspace is already named", async () => {
    mockGetStoredGroupAlias.mockReturnValue("Calimero");
    mockGetGroupMetadata.mockResolvedValue({
      data: { name: "Calimero", data: {}, updatedAt: 0, updatedBy: "x" },
      error: null,
    });

    renderHook(() => useWorkspaceName("g1"));

    await waitFor(() => expect(mockGetGroupMetadata).toHaveBeenCalled());
    expect(mockSetGroupMetadata).not.toHaveBeenCalled();
  });

  it("falls back to a truncated id, and survives a failed read", async () => {
    mockGetGroupMetadata.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useWorkspaceName("1252d374abcdef"));

    await waitFor(() => expect(result.current).toBe("1252d374…"));
  });

  it("does nothing without a workspace", () => {
    const { result } = renderHook(() => useWorkspaceName(""));
    expect(result.current).toBe("Workspace");
    expect(mockGetGroupMetadata).not.toHaveBeenCalled();
  });
});
