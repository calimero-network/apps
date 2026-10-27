// The team page title used to be `Team cdcdcd` on any browser that did not
// create the team (a deep link, a new device): it read only this browser's
// cached name. The namespace's replicated record carries the name for everyone.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectsPage from "./ProjectsPage";
import { ToastProvider } from "../contexts/ToastContext";

const TEAM = "cd".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    listSubgroups: vi.fn(async () => []),
    listGroupContexts: vi.fn(async () => []),
    listGroupMembers: vi.fn(async () => ({ members: [] })),
    getGroupMetadata: vi.fn(async () => ({ name: "Studio" })),
    listApplications: vi.fn(),
  };
  const rpc = { execute: vi.fn(async () => null) };
  return {
    admin,
    mero: { mero: { admin, rpc }, admin, isDelegated: false, applicationId: "app", nodeUrl: "http://node", logout: vi.fn() },
  };
});

vi.mock("@calimero-apps/cloud", async (orig) => ({
  ...(await orig<typeof import("@calimero-apps/cloud")>()),
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));

describe("ProjectsPage – team name", () => {
  it("titles the page with the team's replicated name, not its id", async () => {
    render(
      <MemoryRouter initialEntries={[`/teams/${TEAM}/projects`]}>
        <ToastProvider>
          <Routes>
            <Route path="/teams/:teamId/projects" element={<ProjectsPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Studio" })).toBeInTheDocument();
    expect(stub.admin.getGroupMetadata).toHaveBeenCalledWith(TEAM);
    expect(screen.queryByText(`Team ${TEAM.slice(0, 6)}`)).not.toBeInTheDocument();
  });
});
