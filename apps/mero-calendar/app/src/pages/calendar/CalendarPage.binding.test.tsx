/**
 * The calendar page binds the open calendar for the data layer before any
 * read, and keeps it bound under StrictMode's mount, unmount, mount: the
 * second mount used to skip the bind its first unmount had cleared, and
 * every read after it failed with "No active calendar".
 */
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBinding, resetBinding } from "../../api/binding";

const ME = "acct-me";
const client = withRoutes({ getOrg: vi.fn(), setMemberMetadata: vi.fn() });
const signedIn = { client, accountId: ME, passkey: () => ({}), after: () => {}, targetKey: "local:test" };

/** Every data-layer call, with the calendar bound when it ran. */
const seen: string[] = [];
const bound = (what: string) => {
  const app = getBinding().app;
  seen.push(app);
  if (!app) throw new Error(`No active calendar (${what})`);
};
const data = {
  getMembers: vi.fn(async () => {
    bound("getMembers");
    return { data: [{ id: ME, username: "" }], error: null };
  }),
  setUsername: vi.fn(async () => {
    bound("setUsername");
    return { data: null, error: null };
  }),
};
const actions = {
  getEvents: vi.fn(async () => bound("getEvents")),
  getMembers: vi.fn(async () => bound("getMembers")),
};
const openErrorModal = vi.fn();

vi.mock("../../api/sessionContext", () => ({ useSignedIn: () => signedIn }));
vi.mock("../../api/dataSource/ClientApiDataSource", () => ({
  ClientApiDataSource: vi.fn(function () {
    return data;
  }),
}));
vi.mock("../../components/calendar/Calendar", () => ({ default: () => <p>calendar</p> }));
vi.mock("../../hooks", () => ({
  useActions: () => actions,
  useModal: () => ({ openErrorModal }),
  useAppEvents: () => {},
}));

import CalendarPage from "./index";
import { withRoutes } from "@calimero-apps/connect/testing";

function renderCalendar() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/teams/org-a/calendar/cal-1"]}>
        <Routes>
          <Route path="/teams/:teamId/calendar/:contextId" element={<CalendarPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  localStorage.clear();
  resetBinding();
  client.getOrg.mockResolvedValue({ name: "Alpha", members: { [ME]: "member" }, memberMetadata: { [ME]: { name: "Ada" } } });
});
afterEach(() => resetBinding());

describe("CalendarPage: the open calendar is bound", () => {
  it("reads and syncs your name only with the calendar bound, under StrictMode", async () => {
    const view = renderCalendar();
    expect(await screen.findByText("calendar")).toBeTruthy();
    await waitFor(() => expect(data.setUsername).toHaveBeenCalledWith("Ada"));
    await waitFor(() => expect(actions.getEvents).toHaveBeenCalled());
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((app) => app === "cal-1")).toBe(true);
    expect(openErrorModal).not.toHaveBeenCalled();
    expect(getBinding().app).toBe("cal-1");

    view.unmount();
    expect(getBinding().app).toBe("");
  });
});
