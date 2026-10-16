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

// The real popup creates a namespace on a node; here it only has to be shown
// and to report a creation.
vi.mock("../popups/CreateWorkspacePopup", () => ({
  default: ({ onSuccess, onCancel }: { onSuccess: (id: string) => void; onCancel: () => void }) => (
    <div data-testid="create-workspace-popup">
      <button onClick={() => onSuccess("group-new")}>fake-create</button>
      <button onClick={onCancel}>fake-cancel</button>
    </div>
  ),
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

  describe("New workspace", () => {
    // CreateWorkspacePopup existed but nothing rendered it: a member already
    // inside a workspace had no way to create another.
    it("opens the create popup from the switcher", async () => {
      render(<WorkspaceSwitcher isCollapsed={false} />);
      fireEvent.click(await screen.findByText("Current"));
      fireEvent.click(screen.getByTestId("workspace-switcher-create"));
      expect(screen.getByTestId("create-workspace-popup")).toBeInTheDocument();

      fireEvent.click(screen.getByText("fake-cancel"));
      expect(screen.queryByTestId("create-workspace-popup")).not.toBeInTheDocument();
      expect(mockClearStoredSession).not.toHaveBeenCalled();
    });

    it("drops the old workspace's stored chat once the new one exists", async () => {
      const location = window.location;
      // jsdom refuses navigation; capture the assignment instead.
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...location, href: "" },
      });
      try {
        render(<WorkspaceSwitcher isCollapsed={false} />);
        fireEvent.click(await screen.findByText("Current"));
        fireEvent.click(screen.getByTestId("workspace-switcher-create"));
        fireEvent.click(screen.getByText("fake-create"));

        expect(mockClearStoredSession).toHaveBeenCalled();
        expect(window.location.href).toBe("/");
      } finally {
        Object.defineProperty(window, "location", { configurable: true, value: location });
      }
    });
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
