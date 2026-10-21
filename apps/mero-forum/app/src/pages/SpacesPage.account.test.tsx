import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../contexts/ToastContext";
import { clearApplicationIdCache } from "../hooks/useApplicationId";

// Spaces on a cloud-account session. `mero` is then the relay client, whose
// node routes refuse an account (403), and `listApplications` is node-wide, so
// the relay refuses it too. Everything goes through `useMero().admin` (the
// account admin), scoped by the registry-derived `applicationId`, which lands
// AFTER sign-in. The real `useApplicationId` runs here.

const ME = "ab".repeat(32);

const h = vi.hoisted(() => {
  const forbidden = () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 }));
  // The relay's raw admin: every call refused, so any use of it fails the test.
  const raw = {
    listApplications: vi.fn(forbidden),
    listNamespacesForApplication: vi.fn(forbidden),
    createNamespace: vi.fn(forbidden),
    listGroupMembers: vi.fn(forbidden),
  };
  const admin = {
    listApplications: vi.fn(forbidden),
    listNamespacesForApplication: vi.fn(),
    listGroupMembers: vi.fn(),
    createNamespace: vi.fn(async () => ({ namespaceId: "ns-new" })),
    setDefaultCapabilities: vi.fn(async () => {}),
    setSubgroupVisibility: vi.fn(async () => {}),
    deleteNamespace: vi.fn(),
  };
  const session = {
    mero: { admin: raw },
    admin,
    isDelegated: true,
    applicationId: "app-registry" as string | null,
    logout: () => {},
    nodeUrl: "https://relay.example",
  };
  return { raw, admin, session };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => h.session,
  useNodeIdentity: () => ({ identity: { accountId: "ab".repeat(32) } }),
}));

import SpacesPage from "./SpacesPage";

const page = () => (
  <MemoryRouter initialEntries={["/spaces"]}>
    <ToastProvider>
      <SpacesPage />
    </ToastProvider>
  </MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  clearApplicationIdCache();
  h.session.applicationId = "app-registry";
  h.admin.listNamespacesForApplication.mockResolvedValue([
    { namespaceId: "ns-1", name: "Team", memberCount: 2, subgroupCount: 1 },
  ]);
  h.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Admin" }] });
  HTMLDialogElement.prototype.showModal ??= function () {};
  HTMLDialogElement.prototype.close ??= function () {};
});
afterEach(cleanup);

describe("SpacesPage on a cloud account", () => {
  it("lists through the account admin under the registry id, never the raw client or listApplications", async () => {
    render(page());
    expect(await screen.findByText("Team")).toBeInTheDocument();
    expect(h.admin.listNamespacesForApplication).toHaveBeenCalledWith("app-registry");
    expect(h.admin.listApplications).not.toHaveBeenCalled();
    expect(h.raw.listApplications).not.toHaveBeenCalled();
    expect(h.raw.listNamespacesForApplication).not.toHaveBeenCalled();
  });

  it("waits for the application id instead of reading an empty list as no spaces", async () => {
    h.session.applicationId = null;
    const view = render(page());
    await act(async () => {});
    expect(screen.queryByTestId("spaces-empty")).toBeNull();
    expect(screen.queryByText(/not installed/)).toBeNull();
    expect(h.admin.listNamespacesForApplication).not.toHaveBeenCalled();

    h.session.applicationId = "app-registry";
    view.rerender(page());
    expect(await screen.findByText("Team")).toBeInTheDocument();
  });

  it("says a failed list failed and offers a retry, not a create", async () => {
    h.admin.listNamespacesForApplication.mockRejectedValueOnce(new Error("relay unreachable"));
    render(page());
    expect(await screen.findByTestId("spaces-list-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("spaces-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("spaces-retry"));
    expect(await screen.findByText("Team")).toBeInTheDocument();
  });

  it("creates a space through the account admin", async () => {
    render(page());
    await screen.findByText("Team");
    fireEvent.change(document.getElementById("space-name")!, { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(h.admin.createNamespace).toHaveBeenCalledWith({ applicationId: "app-registry", name: "New" }),
    );
    expect(h.raw.createNamespace).not.toHaveBeenCalled();
  });

  it("does not offer an Admin a delete the account cannot make", async () => {
    render(page());
    fireEvent.click(await screen.findByTestId("space-menu"));
    expect(await screen.findByTestId("delete-space-unavailable")).toBeDisabled();
    expect(screen.queryByTestId("delete-space")).toBeNull();
  });
});
