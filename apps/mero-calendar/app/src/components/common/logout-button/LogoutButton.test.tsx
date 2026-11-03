/**
 * Log out ends the session and returns to the front door.
 *
 * The button is the same component in all three signed-in top bars (teams,
 * a team's calendars, the calendar itself), so this one test covers each.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn(async () => {});

vi.mock("../../../api/sessionContext", () => ({
  useSessionApi: () => ({
    api: {
      session: { status: "signed-in", target: { kind: "local", nodes: ["http://127.0.0.1:2501"] } },
      signOut: logout,
    },
  }),
}));

import LogoutButton from "./LogoutButton";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>landing</p>} />
        <Route path="/teams/:teamId/calendar/:contextId" element={<LogoutButton />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  logout.mockClear();
});

describe("LogoutButton", () => {
  it("is labelled for what it does", () => {
    renderAt("/teams/t/calendar/c");
    const btn = screen.getByTestId("logout-btn");
    expect(btn.getAttribute("aria-label")).toBe("Log out");
    expect(btn.textContent).toContain("Log out");
  });

  it("signs out and lands on the landing page", async () => {
    renderAt("/teams/t/calendar/c");
    fireEvent.click(screen.getByTestId("logout-btn"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("landing")).toBeTruthy();
    expect(screen.queryByTestId("logout-btn")).toBeNull();
  });
});
