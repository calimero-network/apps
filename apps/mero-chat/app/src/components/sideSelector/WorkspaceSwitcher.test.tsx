import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

const {
  mockListGroups,
  mockGetGroupId,
  mockSetGroupId,
  mockClearStoredSession,
  mockGetGroupMetadata,
  mockSetGroupMetadata,
} = vi.hoisted(() => ({
  mockListGroups: vi.fn(),
  mockGetGroupId: vi.fn(),
  mockSetGroupId: vi.fn(),
  mockClearStoredSession: vi.fn(),
  mockGetGroupMetadata: vi.fn(),
  mockSetGroupMetadata: vi.fn(),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    listGroups = mockListGroups;
    // The switcher now reads each workspace's replicated name and backfills a
    // local-only one. Both are best-effort in the component, but an undefined
    // method throws synchronously rather than rejecting, so the mock has to
    // carry them or the listing never renders.
    getGroupMetadata = mockGetGroupMetadata;
    setGroupMetadata = mockSetGroupMetadata;
  },
}));

vi.mock("../../constants/config", () => ({
  getGroupId: mockGetGroupId,
  setGroupId: mockSetGroupId,
  getStoredGroupAlias: () => "",
}));

vi.mock("../../utils/session", () => ({
  clearStoredSession: mockClearStoredSession,
}));

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    mockListGroups.mockReset();
    // No replicated name by default: these tests are about switching, and the
    // component must render the listing whether or not metadata resolves.
    mockGetGroupMetadata.mockReset().mockResolvedValue({ data: null, error: null });
    mockSetGroupMetadata.mockReset().mockResolvedValue({ data: undefined, error: null });
    mockGetGroupId.mockReset();
    mockSetGroupId.mockReset();
    mockClearStoredSession.mockReset();

    mockGetGroupId.mockReturnValue("group-current");
    mockListGroups.mockResolvedValue({
      data: [
        { groupId: "group-current", alias: "Current" },
        { groupId: "group-other", alias: "Other" },
      ],
    });
  });

  it("clears the stored session chat when switching to another workspace", async () => {
    render(<WorkspaceSwitcher isCollapsed={false} />);

    await waitFor(() => {
      expect(mockListGroups).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText("Current"));
    fireEvent.click(await screen.findByText("Other"));

    // Without this the previous workspace's chat is restored on mount and SSE
    // resubscribes to a context the new workspace does not have.
    expect(mockSetGroupId).toHaveBeenCalledWith("group-other");
    expect(mockClearStoredSession).toHaveBeenCalled();
  });

  it("does not clear the session when re-selecting the current workspace", async () => {
    render(<WorkspaceSwitcher isCollapsed={false} />);

    await waitFor(() => {
      expect(mockListGroups).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText("Current"));
    const entries = await screen.findAllByText("Current");
    fireEvent.click(entries[entries.length - 1]);

    expect(mockSetGroupId).not.toHaveBeenCalled();
    expect(mockClearStoredSession).not.toHaveBeenCalled();
  });
});
