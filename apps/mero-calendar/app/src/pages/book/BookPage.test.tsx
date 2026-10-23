/**
 * The page a booking link opens: no session at all, every call goes to the
 * owner's node under the link's grant.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BookPage from "./BookPage";

const TOKEN = "ab".repeat(32);
const NODE = "https://node.example";
const SLOT = Date.UTC(2030, 0, 7, 9, 0);

function respond(returns: unknown): Response {
  return new Response(JSON.stringify({ data: { returns } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const page = (status: string, booking: unknown = null) => ({
  title: "Intro call",
  description: "",
  ownerName: "Ada",
  durationMinutes: 30,
  status,
  expiresAtMs: null,
  booking,
});

const booking = {
  startMs: SLOT,
  endMs: SLOT + 1_800_000,
  guestName: "Grace",
  guestEmail: "grace@example.com",
  guestNote: "",
  bookedAtMs: 1,
  rescheduledCount: 0,
};

let state = "open";
const calls: Array<{ method: string; argsJson: Record<string, unknown> }> = [];

beforeEach(() => {
  state = "open";
  calls.length = 0;
  window.location.hash = `#n=${encodeURIComponent(NODE)}&c=ctx&t=${TOKEN}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      calls.push(body);
      switch (body.method) {
        case "get_booking_page":
          return respond(state === "open" ? page("open") : page(state, booking));
        case "get_available_slots":
          return respond([SLOT, SLOT + 1_800_000]);
        case "book_slot":
          state = "booked";
          return respond(booking);
        case "cancel_booking":
          state = "cancelled";
          return respond(null);
        default:
          throw new Error(`unexpected ${body.method}`);
      }
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("BookPage", () => {
  it("books a slot, then cancels it", async () => {
    render(<BookPage />);
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
    const book = calls.find((c) => c.method === "book_slot");
    expect(book?.argsJson).toMatchObject({
      token: TOKEN,
      start_ms: SLOT,
      guest: { name: "Grace", email: "grace@example.com", note: "" },
    });

    fireEvent.click(screen.getByText("Cancel meeting"));
    expect(await screen.findByText(/This meeting was cancelled/)).toBeTruthy();
    expect(screen.queryAllByTestId("slot")).toHaveLength(0);
  });

  it("says so when the link is incomplete, and calls nothing", async () => {
    window.location.hash = "#n=https://x";
    render(<BookPage />);
    expect(screen.getByText("This booking link is incomplete")).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(0));
  });
});
