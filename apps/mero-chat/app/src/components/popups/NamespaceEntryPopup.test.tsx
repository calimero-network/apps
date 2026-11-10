import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredGroupAlias } from "../../constants/config";
import NamespaceEntryPopup from "./NamespaceEntryPopup";

// The picker no longer joins anything: an invitation arrives as an opened link
// and the app-level prompt joins it. What the picker still owes that flow is
// the name step for a workspace just joined by someone with no name yet, and
// no field to paste an invitation into.

const h = vi.hoisted(() => ({
  listGroups: vi.fn(),
  resolveCurrentMemberIdentity: vi.fn(),
  createGroup: vi.fn(),
  createChannel: vi.fn(),
  listOtherOrgs: vi.fn(),
  sessionKey: "account:me" as string | null,
}));

vi.mock("../../utils/installedApps", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveInstalledAppId: (id: string) => Promise.resolve(id),
}));

vi.mock("../../utils/createChannel", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createChannel: h.createChannel,
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("../../hooks/useSessionKey", () => ({
  useSessionKey: () => h.sessionKey,
}));

vi.mock("../../api/meroJsClient", () => ({
  isDelegatedSession: () => true,
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listGroups = h.listGroups;
    resolveCurrentMemberIdentity = h.resolveCurrentMemberIdentity;
    createGroup = h.createGroup;
    listOtherOrgs = h.listOtherOrgs;
    setDefaultCapabilities = () => Promise.resolve({ data: null, error: null });
    setGroupMetadata = () => Promise.resolve({ data: null, error: null });
    setMemberMetadata = () => Promise.resolve({ data: null, error: null });
    syncGroup = () => Promise.resolve({ data: null, error: null });
  },
}));

beforeEach(() => {
  localStorage.clear();
  h.sessionKey = "account:me";
  sessionStorage.clear();
  h.listGroups.mockReset().mockResolvedValue({
    data: [{ groupId: "ns0", alias: "Mine" }],
    error: null,
  });
  h.resolveCurrentMemberIdentity
    .mockReset()
    .mockResolvedValue({ data: { memberIdentity: "me", members: [] } });
  h.createGroup
    .mockReset()
    .mockResolvedValue({ data: { groupId: "ns-new" }, error: null });
  h.listOtherOrgs.mockReset().mockResolvedValue([
    {
      orgId: "ow",
      name: "overworld",
      role: "owner",
      holds: [{ appId: "b1", name: "overworld", package: "com.calimero.mero-blocks" }],
      label: "Mero Blocks: overworld",
      canCreate: true,
    },
  ]);
  h.createChannel
    .mockReset()
    .mockResolvedValue({ contextId: "ctx-general", memberKey: "key" });
});

function open() {
  render(
    <NamespaceEntryPopup isAuthenticated isConfigSet onLogout={() => {}} />,
  );
}

describe("NamespaceEntryPopup", () => {
  it("waits for a signed-in session before it lists", async () => {
    h.sessionKey = null;
    const view = render(
      <NamespaceEntryPopup isAuthenticated isConfigSet onLogout={() => {}} />,
    );
    expect(h.listGroups).not.toHaveBeenCalled();

    h.sessionKey = "account:me";
    view.rerender(<NamespaceEntryPopup isAuthenticated isConfigSet onLogout={() => {}} />);
    expect(await screen.findByText("Select workspace")).toBeInTheDocument();
    expect(h.listGroups).toHaveBeenCalledTimes(1);
  });

  it("opens on the name step of a workspace an invitation just joined", async () => {
    setStoredGroupAlias("ns1", "Team");
    sessionStorage.setItem("chat:joined-awaiting-name", "ns1");
    open();
    expect(await screen.findByText("Join Team")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Alice")).toBeInTheDocument();
  });

  it("lists workspaces and says how to join another, with no field to paste into", async () => {
    open();
    expect(await screen.findByText("Select workspace")).toBeInTheDocument();
    expect(screen.getByTestId("join-hint")).toHaveTextContent(
      "open the invitation link",
    );
    expect(
      screen.queryByText("Join existing workspace"),
    ).not.toBeInTheDocument();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("says how to join when the node has no workspace yet", async () => {
    h.listGroups.mockResolvedValue({ data: [], error: null });
    open();
    expect(await screen.findByText("Welcome to MeroChat")).toBeInTheDocument();
    expect(screen.getByTestId("join-hint")).toBeInTheDocument();
    expect(
      screen.queryByText("Join existing workspace"),
    ).not.toBeInTheDocument();
  });

  // Every workspace starts with #general, so someone who joins from an
  // invitation lands in a channel instead of an empty workspace, and the join
  // has something to wait for that tells "synced" from "not arrived yet".
  it("creates #general, public, in a new workspace", async () => {
    h.listGroups.mockResolvedValue({ data: [], error: null });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Create workspace" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. My Team"), {
      target: { value: "Design team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(h.createChannel).toHaveBeenCalledWith("ns-new", "general", true),
    );
  });

  // An account in an org made for another app (a Mero Blocks world) has no
  // chat workspace: creating one is the primary action, and that org is only
  // offered behind "Connect to an existing organization".
  describe("an org made for another app", () => {
    it("is neither listed nor preselected: create is primary", async () => {
      h.listGroups.mockResolvedValue({ data: [], error: null });
      open();
      expect(await screen.findByText("Welcome to MeroChat")).toBeInTheDocument();
      expect(screen.queryByText("Select workspace")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button")[0]).toHaveTextContent("Create workspace");
      expect(screen.queryByTestId("connect-org-ow")).not.toBeInTheDocument();
      expect(h.listOtherOrgs).not.toHaveBeenCalled();
      expect(h.resolveCurrentMemberIdentity).not.toHaveBeenCalled();
    });

    it("is offered on request, with what it holds, and chat is added to it on choice", async () => {
      h.listGroups.mockResolvedValue({ data: [], error: null });
      open();
      fireEvent.click(await screen.findByTestId("connect-existing-org"));
      const choice = await screen.findByTestId("connect-org-ow");
      expect(choice).toHaveTextContent("overworld");
      expect(choice).toHaveTextContent("Mero Blocks: overworld");
      fireEvent.click(choice);
      await waitFor(() => expect(h.createChannel).toHaveBeenCalledWith("ow", "general", true));
      expect(await screen.findByText("Join overworld")).toBeInTheDocument();
      expect(h.createGroup).not.toHaveBeenCalled();
    });

    it("is also offered, secondary, next to the workspaces that hold chat", async () => {
      open();
      expect(await screen.findByText("Select workspace")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("ns0");
      expect(screen.getByTestId("connect-existing-org")).toBeInTheDocument();
    });
  });
});
