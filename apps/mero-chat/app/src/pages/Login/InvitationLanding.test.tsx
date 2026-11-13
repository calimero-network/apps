/**
 * An invitation link opened while signed out: the invitation is the page (not
 * the landing hero), and signing in from it brings up the join prompt at once.
 * Rendered the way App.tsx composes them: the prompt above the routes, the
 * signed-out landing below.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  let state = { status: "signed-out", message: null as string | null };
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
    myOrgs: vi.fn(),
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
  signIn: vi.fn(async () => h.set({ status: "signed-in" })),
  signUp: vi.fn(async () => h.set({ status: "signed-in" })),
  approveSignUp: vi.fn(),
  cancelSignUp: vi.fn(),
  getAccountId: () => "acct-me",
}));
vi.mock("../../api/platform", () => ({ myOrgs: h.myOrgs }));
vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    joinGroup = h.joinGroup;
    getGroupMetadata = vi.fn(async () => ({ data: null, error: null }));
  },
}));
vi.mock("../../utils/enterWorkspace", () => ({
  enterWorkspace: vi.fn(),
  enterJoinedWorkspaceForName: vi.fn(),
}));
// The landing page is generated and tested on its own; here it is the door.
vi.mock("../landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Landing sign in
    </button>
  ),
}));

import InvitationPrompt from "../../components/popups/InvitationPrompt";
import { useCalimero } from "../../api/calimero";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";
import { UnauthenticatedLanding } from "./index";

function Harness() {
  const { isAuthenticated } = useCalimero();
  return (
    <>
      <InvitationPrompt enabled={isAuthenticated} />
      <UnauthenticatedLanding />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.set({ status: "signed-out", message: null });
  h.joinGroup.mockReset();
  h.myOrgs.mockReset();
  h.myOrgs.mockResolvedValue([]);
});

describe("an invitation link opened while signed out", () => {
  it("shows the invitation as the page, not the landing hero", () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok-1");
    render(<Harness />);
    expect(screen.getByTestId("invitation-page")).toBeInTheDocument();
    expect(screen.getByText("You're invited")).toBeInTheDocument();
    expect(screen.getByTestId("signin-desc")).toHaveTextContent(
      "You've been invited to join the workspace in Mero Chat.",
    );
    expect(screen.getByTestId("signin-passkey")).toBeInTheDocument();
    expect(screen.getByTestId("signup-passkey")).toBeInTheDocument();
    expect(screen.queryByText("Landing sign in")).not.toBeInTheDocument();
  });

  it("signing in brings up the join prompt straight away", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok-1");
    render(<Harness />);
    fireEvent.click(screen.getByTestId("signin-passkey"));
    expect(
      await screen.findByRole("button", { name: /^join$/i }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok-1");
  });

  it("Not now shows the landing page and keeps the token", () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok-1");
    render(<Harness />);
    fireEvent.click(screen.getByTestId("invitation-not-now"));
    expect(screen.getByText("Landing sign in")).toBeInTheDocument();
    expect(screen.queryByTestId("invitation-page")).not.toBeInTheDocument();
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok-1");
  });

  it("without an invitation, it is the landing page", () => {
    render(<Harness />);
    expect(screen.getByText("Landing sign in")).toBeInTheDocument();
    expect(screen.queryByTestId("invitation-page")).not.toBeInTheDocument();
  });
});
