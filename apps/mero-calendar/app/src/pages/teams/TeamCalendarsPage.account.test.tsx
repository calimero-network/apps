/**
 * The calendar picker on a DELEGATED (account) session.
 *
 * ⚠️ The prod reproduction this pins: `POST /admin-api/namespaces/{ns}/groups`
 * and `POST /admin-api/contexts` on the relay answer an account's token with
 * 403. The page must create the calendar's subgroup and context through
 * `useMero().admin` (delegated creation through the relay) and never through
 * the raw client's `mero.admin`. Leave (`leaveContext`) and the no-subgroup
 * `deleteContext` fallback are a node's own operations and are not offered to
 * an account; deleting a calendar's subgroup (`deleteGroup`) is, to an admin.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountId } from "../../api/identity";

const NS = "a1".repeat(32);
const EXISTING = "c0".repeat(32);
const SUB = "b2".repeat(32);
const ME = "d4".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    listSubgroups: vi.fn(async () => []),
    listGroupContexts: vi.fn(async () => []),
    getContextsForApplication: vi.fn(),
    getContexts: vi.fn(),
    createGroupInNamespace: vi.fn(async () => ({ groupId: "sg1" })),
    setSubgroupVisibility: vi.fn(async () => {}),
    createContext: vi.fn(async () => ({ contextId: "ctx-new", memberPublicKey: "" })),
    setContextMetadata: vi.fn(async () => {}),
    joinContext: vi.fn(async () => ({ contextId: "ctx-new", memberPublicKey: "" })),
    deleteContext: vi.fn(),
    leaveContext: vi.fn(),
    deleteGroup: vi.fn(async () => ({ isDeleted: true })),
    getNodeIdentity: vi.fn(),
    listGroupMembers: vi.fn(),
    listApplications: vi.fn(),
  };
  const rawAdmin = {
    createGroupInNamespace: vi.fn(),
    createContext: vi.fn(),
    listApplications: vi.fn(),
  };
  const showToast = vi.fn();
  return { admin, rawAdmin, showToast };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    admin: stub.admin,
    mero: { admin: stub.rawAdmin },
    isDelegated: true,
    applicationId: "app-from-registry",
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
  setApplicationId: vi.fn(),
  getApplicationId: () => "",
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: stub.showToast }),
}));
vi.mock("../../components/common/theme-toggle/ThemeToggle", () => ({
  default: () => null,
}));
vi.mock("./TeamMembersPanel", () => ({ default: () => null }));

import TeamCalendarsPage from "./TeamCalendarsPage";

function open() {
  return render(
    <MemoryRouter initialEntries={[`/teams/${NS}`]}>
      <Routes>
        <Route path="/teams/:teamId" element={<TeamCalendarsPage />} />
        <Route
          path="/teams/:teamId/calendar/:contextId"
          element={<div data-testid="calendar-route" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetAccountId();
  stub.admin.listSubgroups.mockResolvedValue([]);
  stub.admin.listGroupContexts.mockResolvedValue([]);
  stub.admin.getNodeIdentity.mockResolvedValue({ accountId: ME });
  stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Admin" }] });
});

describe("an account creating a calendar", () => {
  it("creates the subgroup and context through the account admin, never the raw client", async () => {
    open();
    fireEvent.change(await screen.findByTestId("new-calendar-input"), {
      target: { value: "Sprints" },
    });
    fireEvent.click(screen.getByTestId("create-calendar-btn"));

    await waitFor(() => expect(stub.admin.createContext).toHaveBeenCalled());
    expect(stub.admin.createGroupInNamespace).toHaveBeenCalledWith(NS, {
      groupName: "Sprints",
      visibility: "open",
    });
    expect(stub.admin.createContext).toHaveBeenCalledWith({
      applicationId: "app-from-registry",
      groupId: "sg1",
      name: "Sprints",
      initializationParams: [],
    });
    expect(stub.rawAdmin.createGroupInNamespace).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createContext).not.toHaveBeenCalled();
    await screen.findByTestId("calendar-route");
  });

  it("never asks for a node-wide listing the relay does not answer", async () => {
    stub.admin.listGroupContexts.mockResolvedValue([{ contextId: EXISTING, name: "Ops" }]);
    open();
    await screen.findByTestId(`calendar-card-${EXISTING}`);
    // A namespace is bound to one application by core, so the team's own
    // contexts are the calendars; `/contexts/for-application` and
    // `/applications` are node questions.
    expect(stub.admin.getContextsForApplication).not.toHaveBeenCalled();
    expect(stub.admin.getContexts).not.toHaveBeenCalled();
    expect(stub.admin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listApplications).not.toHaveBeenCalled();
  });
});

describe("an account's calendar list", () => {
  it("does not offer Leave or the no-subgroup Delete: both are a node's own operations", async () => {
    stub.admin.listGroupContexts.mockResolvedValue([{ contextId: EXISTING, name: "Ops" }]);
    open();
    await screen.findByTestId(`calendar-card-${EXISTING}`);
    expect(screen.queryByTestId(`calendar-menu-${EXISTING}`)).toBeNull();
    expect(screen.queryByTestId(`leave-calendar-${EXISTING}`)).toBeNull();
    expect(screen.queryByTestId(`delete-calendar-${EXISTING}`)).toBeNull();
  });

  it("lets an admin delete a calendar as its subgroup, through the account admin", async () => {
    stub.admin.listSubgroups.mockResolvedValue([{ groupId: SUB }]);
    stub.admin.listGroupContexts.mockImplementation(async (gid: string) =>
      gid === SUB ? [{ contextId: EXISTING, name: "Ops" }] : [],
    );
    open();
    fireEvent.click(await screen.findByTestId(`calendar-menu-${EXISTING}`));
    expect(screen.queryByTestId(`leave-calendar-${EXISTING}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`delete-calendar-${EXISTING}`));
    fireEvent.click(screen.getByTestId("confirm-delete-btn"));

    await waitFor(() => expect(stub.admin.deleteGroup).toHaveBeenCalledWith(SUB));
    expect(stub.admin.deleteContext).not.toHaveBeenCalled();
  });

  it("offers a non-admin account nothing to remove", async () => {
    stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Member" }] });
    stub.admin.listSubgroups.mockResolvedValue([{ groupId: SUB }]);
    stub.admin.listGroupContexts.mockImplementation(async (gid: string) =>
      gid === SUB ? [{ contextId: EXISTING, name: "Ops" }] : [],
    );
    open();
    await screen.findByTestId(`calendar-card-${EXISTING}`);
    await waitFor(() => expect(stub.admin.listGroupMembers).toHaveBeenCalledWith(SUB));
    expect(screen.queryByTestId(`calendar-menu-${EXISTING}`)).toBeNull();
  });
});
