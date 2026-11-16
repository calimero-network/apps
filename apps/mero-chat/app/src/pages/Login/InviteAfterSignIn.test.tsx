/**
 * Product-owner report: "when accepting an invite in chat the user logs in
 * and is asked to create a workspace instead of joining the organization
 * which issued the invite."
 *
 * Signed in, `/login` renders the workspace picker (`NamespaceEntryPopup`, a
 * full-screen overlay at z-index 99999) and App.tsx renders the invitation's
 * Join prompt (`InvitationPrompt`, a modal at z-index 20) beside it, so the
 * picker covered the invitation with "Create workspace". Rendered here the way
 * App.tsx composes them, with the real picker and prompt.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  let state = {
    status: "signed-out",
    message: null as string | null,
    accountId: null as string | null,
  };
  const listeners = new Set<() => void>();
  return {
    get state() {
      return state;
    },
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    joinGroup: vi.fn(),
    listGroups: vi.fn(),
    myOrgs: vi.fn(),
    enterWorkspace: vi.fn(),
    enterJoinedWorkspaceForName: vi.fn(),
  };
});

vi.mock("../../api/calimero", () => ({
  LISTING: {
    name: "Mero Chat",
    description: "",
    package: "p",
    dir: "mero-chat",
    dev: true,
  },
  useCalimero: () => {
    const s = useSyncExternalStore(h.subscribe, () => h.state);
    return {
      ...s,
      isAuthenticated: s.status === "signed-in",
      isLoading: false,
      logout: vi.fn(),
    };
  },
  signIn: vi.fn(async () =>
    h.set({ status: "signed-in", accountId: "acct-me" }),
  ),
  signUp: vi.fn(async () =>
    h.set({ status: "signed-in", accountId: "acct-me" }),
  ),
  approveSignUp: vi.fn(),
  cancelSignUp: vi.fn(),
  getAccountId: () => "acct-me",
}));
vi.mock("../../api/platform", () => ({ myOrgs: h.myOrgs }));
vi.mock("../../api/meroJsClient", () => ({ isDelegatedSession: () => true }));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    joinGroup = h.joinGroup;
    listGroups = h.listGroups;
    getGroupMetadata = vi.fn(async () => ({ data: null, error: null }));
    resolveCurrentMemberIdentity = vi.fn(async () => ({
      data: null,
      error: null,
    }));
    setMemberMetadata = vi.fn(async () => ({ data: null, error: null }));
  },
}));
vi.mock("../../utils/enterWorkspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enterWorkspace: h.enterWorkspace,
  enterJoinedWorkspaceForName: h.enterJoinedWorkspaceForName,
}));
vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("../landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Landing sign in
    </button>
  ),
}));

import InvitationPrompt from "../../components/popups/InvitationPrompt";
import { useCalimero } from "../../api/calimero";
import { INVITATION_STORAGE_KEY, SPENT_INVITE } from "../../utils/invitation";
import { markJoinedAwaitingName } from "../../utils/enterWorkspace";
import Login from "./index";

/** `/login` as App.tsx renders it: the prompt above the routes, then the page. */
function Harness() {
  const { isAuthenticated } = useCalimero();
  return (
    <MemoryRouter>
      <InvitationPrompt enabled={isAuthenticated} />
      <Login isAuthenticated={isAuthenticated} isConfigSet={isAuthenticated} />
    </MemoryRouter>
  );
}

/** The picker in any of its screens. */
function picker() {
  return (
    screen.queryByText("Welcome to MeroChat") ??
    screen.queryByText("Create workspace") ??
    screen.queryByText("Select workspace")
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.set({ status: "signed-out", message: null, accountId: null });
  h.joinGroup.mockReset();
  h.enterWorkspace.mockReset();
  h.enterJoinedWorkspaceForName.mockReset();
  h.myOrgs.mockReset().mockResolvedValue([]);
  h.listGroups.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("an invitation link, then signing in with an account that has no workspace", () => {
  it("offers the invitation's Join, not the picker's Create workspace", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok-1");
    render(<Harness />);
    fireEvent.click(screen.getByTestId("signin-passkey"));
    expect(
      await screen.findByRole("button", { name: /^join$/i }),
    ).toBeInTheDocument();
    // Let the picker's load settle, if it was (wrongly) mounted.
    await act(async () => {});
    expect(picker()).toBeNull();
  });

  it("Join redeems the invite and enters the inviting workspace under the name chosen beside it", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok-1");
    h.joinGroup.mockResolvedValue({
      data: { groupId: "org-inviter", memberIdentity: "acct-me" },
      error: null,
    });
    render(<Harness />);
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await vi.waitFor(() =>
      expect(h.joinGroup).toHaveBeenCalledWith({ invitation: "tok-1" }),
    );
    await vi.waitFor(() =>
      expect(h.enterWorkspace).toHaveBeenCalledWith(expect.anything(), "org-inviter", "Ann", "acct-me"),
    );
    // Asked once, here: not again on the picker.
    expect(h.enterJoinedWorkspaceForName).not.toHaveBeenCalled();
    expect(picker()).toBeNull();
  });

  it("a refused invite says so, and only then does the picker offer Create workspace", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok-1");
    h.joinGroup.mockResolvedValue({
      data: null,
      error: { code: 404, message: "unknown invite" },
    });
    render(<Harness />);
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SPENT_INVITE);
    expect(picker()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Welcome to MeroChat")).toBeInTheDocument();
  });

  it("without an invitation, the picker offers Create workspace", async () => {
    h.set({ status: "signed-in", accountId: "acct-me" });
    render(<Harness />);
    expect(await screen.findByText("Welcome to MeroChat")).toBeInTheDocument();
  });
});

describe("an invitation link, then a sign-up that joined in that step", () => {
  it("opens on the inviting workspace's name step, even before the node lists it", async () => {
    // What `signUp` leaves behind when the invite went with the sign-up.
    markJoinedAwaitingName("org-inviter");
    h.set({ status: "signed-in", accountId: "acct-me" });
    render(<Harness />);
    expect(
      await screen.findByText(/^Join Workspace org-in/),
    ).toBeInTheDocument();
    expect(picker()).toBeNull();
  });
});
