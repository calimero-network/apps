/**
 * The event popup's OWNER GATE.
 *
 * ⚠️ This is the regression test for the defect that made the calendar look
 * read-only to everyone: the gate compared the context SIGNING KEY
 * (`getContextIdentity()`) against `event.owner`, which the contract writes as
 * the ACCOUNT (`env::account_id()`). Since core rc.27 both are 64 hex
 * characters, so the comparison threw nothing, logged nothing and warned
 * nothing — it was simply false for every event, including your own. Delete
 * never rendered and Edit always rendered as "View".
 *
 * The cases below are therefore written against the two ids explicitly, so a
 * future change that reaches for the key again fails here rather than in
 * somebody's browser.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "a".repeat(64);
const SIGNING_KEY = "b".repeat(64);
const OTHER_ACCOUNT = "c".repeat(64);

const deleteEvent = vi.fn();
const closePopup = vi.fn();
const openModalEdit = vi.fn();
const openErrorModal = vi.fn();

let events: Array<Record<string, unknown>> = [];
let me = "";

vi.mock("../../../api/identity", () => ({ accountId: () => me }));

vi.mock("../../../hooks/index", () => ({
  useActions: () => ({ deleteEvent }),
  usePopup: () => ({ closePopup }),
  useModal: () => ({ openModalEdit, openErrorModal }),
  useTypedSelector: (sel: (s: { events: { events: unknown[] } }) => unknown) =>
    sel({ events: { events } }),
  useWindowSize: () => ({ width: 1280, height: 900 }),
  useClickOutside: () => undefined,
}));

import Popup from "./Popup";

function event(overrides: Record<string, unknown> = {}) {
  return { id: "ev-1", owner: ACCOUNT, private: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [event()];
  me = ACCOUNT;
});

describe("owning the event", () => {
  it("offers Delete and Edit", () => {
    render(<Popup x={10} y={10} eventId="ev-1" />);
    expect(screen.getByTestId("popup-delete")).toBeTruthy();
    expect(screen.getByTestId("popup-edit")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.queryByText("View")).toBeNull();
  });

  it("routes a delete to the right storage for a SHARED event", () => {
    render(<Popup x={10} y={10} eventId="ev-1" />);
    screen.getByTestId("popup-delete").click();
    expect(deleteEvent).toHaveBeenCalledWith({
      eventId: "ev-1",
      isPrivate: false,
    });
  });

  it("routes a delete to private storage for a PRIVATE event", () => {
    events = [event({ private: true })];
    render(<Popup x={10} y={10} eventId="ev-1" />);
    screen.getByTestId("popup-delete").click();
    expect(deleteEvent).toHaveBeenCalledWith({
      eventId: "ev-1",
      isPrivate: true,
    });
  });
});

describe("not owning the event", () => {
  it("offers View only — no Delete", () => {
    me = OTHER_ACCOUNT;
    render(<Popup x={10} y={10} eventId="ev-1" />);
    expect(screen.queryByTestId("popup-delete")).toBeNull();
    expect(screen.getByTestId("popup-view")).toBeTruthy();
    expect(screen.getByText("View")).toBeTruthy();
  });
});

describe("the account/key confusion that caused the bug", () => {
  it("does NOT treat the signing key as ownership of your own event", () => {
    // The exact broken state: the node holds this event, the account owns it,
    // but the component was handed the context signing key. Both are 64 hex.
    me = SIGNING_KEY;
    render(<Popup x={10} y={10} eventId="ev-1" />);
    expect(screen.queryByTestId("popup-delete")).toBeNull();
    expect(screen.getByText("View")).toBeTruthy();
  });

  it("owns it when handed the ACCOUNT", () => {
    me = ACCOUNT;
    render(<Popup x={10} y={10} eventId="ev-1" />);
    expect(screen.getByTestId("popup-delete")).toBeTruthy();
  });
});

describe("an unknown identity", () => {
  it("owns NOTHING rather than everything", () => {
    // `loadAccountId` returns "" when /identity cannot be read. An event's
    // owner is never "", so this must not match — degrade to read-only.
    me = "";
    events = [event({ owner: "" })];
    render(<Popup x={10} y={10} eventId="ev-1" />);
    expect(screen.queryByTestId("popup-delete")).toBeNull();
    expect(screen.getByText("View")).toBeTruthy();
  });
});
