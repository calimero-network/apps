/**
 * Your name in a calendar is the team's: asked once for the team, never per
 * calendar, and copied into each calendar's roster without asking.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "acct-me";
const client = withRoutes({ getOrg: vi.fn(), setMemberMetadata: vi.fn() });
const signedIn = { client, accountId: ME, passkey: () => ({}), after: () => {}, targetKey: "local:test" };
const data = { getMembers: vi.fn(), setUsername: vi.fn() };
const actions = { getEvents: vi.fn(async () => {}), getMembers: vi.fn(async () => {}) };

vi.mock("../../api/sessionContext", () => ({ useSignedIn: () => signedIn }));
vi.mock("../../api/binding", () => ({ bindCalendar: vi.fn(), getBinding: () => ({ app: "cal-1" }) }));
vi.mock("../../api/dataSource/ClientApiDataSource", () => ({
  ClientApiDataSource: vi.fn(function () {
    return data;
  }),
}));
vi.mock("../../components/calendar/Calendar", () => ({ default: () => <p>calendar</p> }));
vi.mock("../../hooks", () => ({
  useActions: () => actions,
  useModal: () => ({ openErrorModal: vi.fn() }),
  useAppEvents: () => {},
}));

import CalendarPage from "./index";
import { withRoutes } from "@calimero-apps/connect/testing";

function renderCalendar(contextId = "cal-1") {
  return render(
    <MemoryRouter initialEntries={[`/teams/org-a/calendar/${contextId}`]}>
      <Routes>
        <Route path="/teams/:teamId/calendar/:contextId" element={<CalendarPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const team = (meta: Record<string, unknown>) => ({ name: "Alpha", members: { [ME]: "member" }, memberMetadata: meta });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  data.getMembers.mockResolvedValue({ data: [{ id: ME, username: "" }], error: null });
  data.setUsername.mockResolvedValue({ data: null, error: null });
  client.setMemberMetadata.mockResolvedValue(undefined);
});

describe("CalendarPage: your name", () => {
  it("never asks in a team that has your name, and feeds it to the calendar's roster", async () => {
    client.getOrg.mockResolvedValue(team({ [ME]: { name: "Ada" } }));
    renderCalendar();
    expect(await screen.findByText("calendar")).toBeTruthy();
    await waitFor(() => expect(data.setUsername).toHaveBeenCalledWith("Ada"));
    expect(screen.queryByTestId("username-modal")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("does not rename when the roster already has the team's name", async () => {
    client.getOrg.mockResolvedValue(team({ [ME]: { name: "Ada" } }));
    data.getMembers.mockResolvedValue({ data: [{ id: ME, username: "Ada" }], error: null });
    renderCalendar();
    expect(await screen.findByText("calendar")).toBeTruthy();
    expect(screen.queryByTestId("username-modal")).toBeNull();
    expect(data.setUsername).not.toHaveBeenCalled();
  });

  it("adopts a name the calendar already knew into the team, without asking", async () => {
    client.getOrg.mockResolvedValue(team({}));
    localStorage.setItem("mc-username-cal-1", "Ada");
    renderCalendar();
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-a", ME, { name: "Ada" }));
    expect(screen.queryByTestId("username-modal")).toBeNull();
    await waitFor(() => expect(data.setUsername).toHaveBeenCalledWith("Ada"));
  });

  it("asks once for a team made before names were asked, and saves it on the team", async () => {
    client.getOrg.mockResolvedValue(team({}));
    renderCalendar();
    const input = await screen.findByTestId("username-input");
    expect(screen.getByText("Your name in this team")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Ada" } });
    fireEvent.click(screen.getByTestId("username-submit"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-a", ME, { name: "Ada" }));
    await waitFor(() => expect(screen.queryByTestId("username-modal")).toBeNull());
    await waitFor(() => expect(data.setUsername).toHaveBeenCalledWith("Ada"));
  });

  it("waits for the team's names instead of asking before they load", async () => {
    client.getOrg.mockReturnValue(new Promise(() => {}));
    renderCalendar();
    expect(await screen.findByText("calendar")).toBeTruthy();
    expect(screen.queryByTestId("username-modal")).toBeNull();
  });
});
