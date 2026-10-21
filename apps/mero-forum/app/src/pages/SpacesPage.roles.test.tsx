import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../contexts/ToastContext";

// A space's menu offers exactly one way out: an Admin deletes it, anyone else
// leaves it. The reported bug was an admin offered "Leave" and no Delete; the
// converse (a member offered a Delete the node refuses) is the same bug.

const ME = "ab".repeat(32);

const h = vi.hoisted(() => {
  const admin = {
    listNamespacesForApplication: vi.fn(async () => [
      { namespaceId: "ns-1", name: "Team", memberCount: 2, subgroupCount: 1 },
    ]),
    listGroupMembers: vi.fn(),
    deleteNamespace: vi.fn(async () => ({ isDeleted: true })),
    leaveNamespace: vi.fn(async () => {}),
  };
  const session = { mero: { admin }, admin, logout: () => {}, nodeUrl: null };
  return { admin, session };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => h.session,
  useNodeIdentity: () => ({ identity: { accountId: "ab".repeat(32) } }),
}));

vi.mock("../hooks/useApplicationId", () => ({
  useApplicationId: () => ({ appId: "app-1", resolving: false, notInstalled: false }),
}));

import SpacesPage from "./SpacesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/spaces"]}>
      <ToastProvider>
        <SpacesPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function openMenu() {
  fireEvent.click(await screen.findByTestId("space-menu"));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function () {};
  HTMLDialogElement.prototype.close ??= function () {};
});
afterEach(cleanup);

describe("a space's menu", () => {
  it("offers an Admin Delete, never Leave", async () => {
    h.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Admin" }] });
    renderPage();
    await openMenu();
    expect(await screen.findByTestId("delete-space")).toBeInTheDocument();
    expect(screen.queryByTestId("leave-space")).not.toBeInTheDocument();
  });

  it("offers a Member Leave, never Delete, and leaves through leaveNamespace", async () => {
    h.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Member" }] });
    renderPage();
    await openMenu();
    const leave = await screen.findByTestId("leave-space");
    expect(screen.queryByTestId("delete-space")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(leave);
    });
    await waitFor(() => expect(h.admin.leaveNamespace).toHaveBeenCalledWith("ns-1"));
    expect(h.admin.deleteNamespace).not.toHaveBeenCalled();
  });
});
