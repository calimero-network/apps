/**
 * Log out ends the session and returns to the front door.
 *
 * The button is the same component in all three signed-in top bars (teams,
 * a team's calendars, the calendar itself), so this one test covers each.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn();

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ logout }),
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

  it("clears the session through mero-react and lands on the landing page", () => {
    renderAt("/teams/t/calendar/c");
    fireEvent.click(screen.getByTestId("logout-btn"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByText("landing")).toBeTruthy();
    expect(screen.queryByTestId("logout-btn")).toBeNull();
  });
});
