/**
 * The team page title used to be `Team a1a1a1` on any browser that did not
 * create the team (a deep link, a new device): it read only this browser's
 * cached name. The namespace's replicated record carries it for everyone.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const NS = "a1".repeat(32);

const stub = vi.hoisted(() => ({
  admin: {
    listSubgroups: vi.fn(async () => []),
    listGroupContexts: vi.fn(async () => []),
    getGroupMetadata: vi.fn(async () => ({ name: "Ops crew" })),
  },
}));

vi.mock("@calimero-apps/cloud", async (orig) => ({
  ...(await orig<typeof import("@calimero-apps/cloud")>()),
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
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../../components/common/theme-toggle/ThemeToggle", () => ({
  default: () => null,
}));
vi.mock("./TeamMembersPanel", () => ({ default: () => null }));

import TeamCalendarsPage from "./TeamCalendarsPage";

describe("the team page title", () => {
  it("shows the team's replicated name, not its id", async () => {
    render(
      <MemoryRouter initialEntries={[`/teams/${NS}`]}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamCalendarsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Ops crew" }),
    ).toBeTruthy();
    expect(stub.admin.getGroupMetadata).toHaveBeenCalledWith(NS);
    expect(screen.queryByText(`Team ${NS.slice(0, 6)}`)).toBeNull();
  });
});
