import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

const {
  mockListGroups,
  mockGetGroupId,
  mockSetGroupId,
  mockClearStoredSession,
} = vi.hoisted(() => ({
  mockListGroups: vi.fn(),
  mockGetGroupId: vi.fn(),
  mockSetGroupId: vi.fn(),
  mockClearStoredSession: vi.fn(),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    listGroups = mockListGroups;
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
