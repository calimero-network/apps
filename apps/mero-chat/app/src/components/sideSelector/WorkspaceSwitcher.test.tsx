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
  mockListMembers,
} = vi.hoisted(() => ({
  mockListGroups: vi.fn(),
  mockGetGroupId: vi.fn(),
  mockSetGroupId: vi.fn(),
  mockClearStoredSession: vi.fn(),
  mockGetGroupMetadata: vi.fn(),
  mockSetGroupMetadata: vi.fn(),
  mockListMembers: vi.fn(),
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
    // Read for the TEE indicator; no TEE unless a test says otherwise.
    listMembers = mockListMembers;
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
    mockListMembers.mockReset().mockResolvedValue({
      data: { members: [], teeMembers: [] },
      error: null,
    });
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

    // findBy, not getBy: `listGroups` being CALLED does not mean its result has
    // rendered, and on a slow runner the name is not there yet.
    fireEvent.click(await screen.findByText("Current"));
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

    // findBy, not getBy: `listGroups` being CALLED does not mean its result has
    // rendered, and on a slow runner the name is not there yet.
    fireEvent.click(await screen.findByText("Current"));
    const entries = await screen.findAllByText("Current");
    fireEvent.click(entries[entries.length - 1]);

    expect(mockSetGroupId).not.toHaveBeenCalled();
    expect(mockClearStoredSession).not.toHaveBeenCalled();
  });

  describe("TEE indicator", () => {
    // Workspace Admin shows TEE status to admins only. Every member sees this
    // shield, read from the namespace's own member list.
    const withTee = () =>
      mockListMembers.mockResolvedValue({
        data: { members: [], teeMembers: [{ identity: "cb62", role: "RelayTee" }] },
        error: null,
      });

    it("shows a shield beside the workspace name when the namespace has a TEE node", async () => {
      withTee();
      render(<WorkspaceSwitcher isCollapsed={false} />);

      expect(await screen.findByLabelText("TEE enabled")).toBeInTheDocument();
      expect(mockListMembers).toHaveBeenCalledWith("group-current");
    });

    it("shows no shield when the namespace has no TEE node", async () => {
      render(<WorkspaceSwitcher isCollapsed={false} />);

      await screen.findByText("Current");
      await waitFor(() => expect(mockListMembers).toHaveBeenCalled());
      expect(screen.queryByLabelText("TEE enabled")).not.toBeInTheDocument();
    });

    it("explains the TEE at the top of the workspace menu", async () => {
      withTee();
      render(<WorkspaceSwitcher isCollapsed={false} />);

      await screen.findByLabelText("TEE enabled");
      fireEvent.click(await screen.findByText("Current"));

      expect(screen.getByText(/hardware-attested node keeps this workspace in sync/i)).toBeInTheDocument();
    });
  });
});
