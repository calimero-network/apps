/**
 * Removing a calendar on a NODE session.
 *
 * ⚠️ The reproduction this pins: "Delete calendar" called `deleteContext`,
 * which is `DELETE /admin-api/contexts/:id` — and the app's token carries no
 * `context:delete`, so the node answered 403 and nothing was deleted. A
 * calendar is a subgroup holding one context; it is deleted as the subgroup
 * (`deleteGroup`, which cascades to the context), offered to an Admin only.
 * Anyone else is offered Leave, and an Admin never is.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountId } from "../../api/identity";

const NS = "a1".repeat(32);
const SUB = "b2".repeat(32);
const CAL = "c3".repeat(32);
const ME = "d4".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    listApplications: vi.fn(async () => {
      throw new Error("unreachable");
    }),
    listNamespacesForApplication: vi.fn(),
    listSubgroups: vi.fn(),
    listGroupContexts: vi.fn(),
    getNodeIdentity: vi.fn(),
    listGroupMembers: vi.fn(),
    deleteGroup: vi.fn(),
    deleteContext: vi.fn(),
    leaveContext: vi.fn(),
    getGroupMetadata: vi.fn(async () => ({})),
  };
  const showToast = vi.fn();
  return { admin, showToast };
});

vi.mock("@calimero-network/mero-react", async (orig) => ({
  ...(await orig<typeof import("@calimero-network/mero-react")>()),
  useMero: () => ({
    admin: stub.admin,
    isDelegated: false,
    applicationId: "app-1",
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
      </Routes>
    </MemoryRouter>,
  );
}

function roleIn(team: string, sub: string) {
  stub.admin.listGroupMembers.mockImplementation(async (gid: string) => ({
    members: [{ identity: ME, role: gid === NS ? team : sub }],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetAccountId();
  stub.admin.listNamespacesForApplication.mockResolvedValue([
    { namespaceId: NS, targetApplicationId: "app-1" },
  ]);
  stub.admin.listSubgroups.mockResolvedValue([{ groupId: SUB }]);
  stub.admin.listGroupContexts.mockImplementation(async (gid: string) =>
    gid === SUB ? [{ contextId: CAL, name: "Ops" }] : [],
  );
  stub.admin.getNodeIdentity.mockResolvedValue({ accountId: ME });
  stub.admin.deleteGroup.mockResolvedValue({ isDeleted: true });
  stub.admin.deleteContext.mockRejectedValue(
    Object.assign(new Error("permission denied"), { status: 403 }),
  );
  roleIn("Admin", "Member");
});

describe("deleting a calendar", () => {
  it("deletes a team admin's calendar as its subgroup, never through deleteContext", async () => {
    open();
    fireEvent.click(await screen.findByTestId(`calendar-menu-${CAL}`));
    expect(screen.queryByTestId(`leave-calendar-${CAL}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`delete-calendar-${CAL}`));
    fireEvent.click(screen.getByTestId("confirm-delete-btn"));

    await waitFor(() => expect(stub.admin.deleteGroup).toHaveBeenCalledWith(SUB));
    expect(stub.admin.deleteContext).not.toHaveBeenCalled();
    expect(stub.showToast).toHaveBeenCalledWith("Calendar deleted.", "success");
  });

  it("offers Delete to the calendar's own admin who is not a team admin", async () => {
    roleIn("Member", "Admin");
    open();
    fireEvent.click(await screen.findByTestId(`calendar-menu-${CAL}`));
    expect(screen.getByTestId(`delete-calendar-${CAL}`)).toBeTruthy();
    expect(screen.queryByTestId(`leave-calendar-${CAL}`)).toBeNull();
  });

  it("keeps the calendar and says why when the delete is refused", async () => {
    stub.admin.deleteGroup.mockRejectedValue(new Error("not an admin"));
    open();
    fireEvent.click(await screen.findByTestId(`calendar-menu-${CAL}`));
    fireEvent.click(screen.getByTestId(`delete-calendar-${CAL}`));
    fireEvent.click(screen.getByTestId("confirm-delete-btn"));

    await waitFor(() => expect(stub.showToast).toHaveBeenCalled());
    expect(String(stub.showToast.mock.calls[0][0])).toMatch(/not an admin/);
    expect(screen.getByTestId(`calendar-card-${CAL}`)).toBeTruthy();
  });

  it("offers a non-admin Leave, never Delete", async () => {
    roleIn("Member", "Member");
    open();
    fireEvent.click(await screen.findByTestId(`calendar-menu-${CAL}`));
    expect(screen.getByTestId(`leave-calendar-${CAL}`)).toBeTruthy();
    expect(screen.queryByTestId(`delete-calendar-${CAL}`)).toBeNull();
  });
});
