/**
 * The page a booking link opens: no session at all, every call goes to the
 * cluster with the link's API key, on a client of the guest's own.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "../../api/sessionContext";
import type { SessionDeps } from "../../api/session";
import BookPage from "./BookPage";
import { withRoutes } from "@calimero-apps/connect/testing";

const TOKEN = "mk_guest_key";
const APP = "app-1";
const SLOT = Date.UTC(2030, 0, 7, 9, 0);

const page = (status: string, booking: unknown = null) => ({
  title: "Intro call",
  description: "",
  ownerName: "Ada",
  durationMinutes: 30,
  status,
  expiresAtMs: null,
  booking,
});

// As the contract answers it: u64s are decimal strings.
const booking = {
  startMs: String(SLOT),
  endMs: String(SLOT + 1_800_000),
  guestName: "Grace",
  guestEmail: "grace@example.com",
  guestNote: "",
  bookedAtMs: "1",
  rescheduledCount: 0,
};

let state = "open";
const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
const keys: string[] = [];

function fakeClient() {
  const answer = (_app: string, method: string, args: Record<string, unknown> = {}) => {
    calls.push({ method, args });
    switch (method) {
      case "getBookingPage":
        return { index: 1, result: state === "open" ? page("open") : page(state, booking) };
      case "getAvailableSlots":
        return { index: 1, result: [String(SLOT), String(SLOT + 1_800_000)] };
      case "bookSlot":
        state = "booked";
        return { index: 2, result: booking };
      case "cancelBooking":
        state = "cancelled";
        return { index: 3, result: null };
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return withRoutes({
    session: undefined,
    useApiKey: (key: string) => keys.push(key),
    call: vi.fn(async (app: string, method: string, args?: Record<string, unknown>) => answer(app, method, args)),
    view: vi.fn(async (app: string, method: string, args?: Record<string, unknown>) => answer(app, method, args)),
  });
}

const memory = new Map<string, string>();
const deps: SessionDeps = {
  env: { VITE_CALIMERO_TARGET: "local", DEV: true } as never,
  makeClient: async () => fakeClient() as never,
  passkey: () => ({}) as never,
  storage: {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  },
  servedNodes: async () => null,
};

const renderPage = () =>
  render(
    <SessionProvider deps={deps}>
      <BookPage />
    </SessionProvider>,
  );

beforeEach(() => {
  state = "open";
  calls.length = 0;
  keys.length = 0;
  window.location.hash = `#a=${APP}&t=${TOKEN}`;
});

afterEach(() => {
  window.location.hash = "";
});

describe("BookPage", () => {
  it("books a slot, then cancels it", async () => {
    renderPage();
    expect(await screen.findByText("Intro call")).toBeTruthy();
    expect(screen.getByText("Meet Ada")).toBeTruthy();

    const slots = await screen.findAllByTestId("slot");
    expect(slots).toHaveLength(2);
    fireEvent.click(slots[0]);
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Grace" } });
    fireEvent.change(screen.getByPlaceholderText("Your email"), {
      target: { value: "grace@example.com" },
    });
    fireEvent.click(screen.getByTestId("book-submit"));

    expect(await screen.findByTestId("booked")).toBeTruthy();
    const book = calls.find((c) => c.method === "bookSlot");
    expect(book?.args).toMatchObject({
      token: TOKEN,
      startMs: String(SLOT),
      guest: { name: "Grace", email: "grace@example.com", note: "" },
    });
    expect(keys).toEqual([TOKEN]);

    fireEvent.click(screen.getByText("Cancel meeting"));
    expect(await screen.findByText(/This meeting was cancelled/)).toBeTruthy();
    expect(screen.queryAllByTestId("slot")).toHaveLength(0);
  });

  it("says so when the link is incomplete, and calls nothing", async () => {
    window.location.hash = "#a=app-1";
    renderPage();
    expect(screen.getByText("This booking link is incomplete")).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(0));
  });
});
