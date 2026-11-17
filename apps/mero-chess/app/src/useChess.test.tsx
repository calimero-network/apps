import { act, renderHook, waitFor } from "@testing-library/react";
import { withRoutes } from "@calimero-apps/connect/testing";
import { describe, expect, it, vi } from "vitest";

import type { SeatView, WireTableView } from "./chess";
import { useChessTable } from "./useChess";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const seat = (s: string): SeatView => ({ seat: s, member: "", name: "", online: false });

const TABLE: WireTableView = {
  title: "Table 1",
  createdAt: "0",
  game: 0,
  fen: START,
  sideToMove: "white",
  moves: [],
  legalMoves: [],
  status: "awaitingPlayers",
  result: "*",
  reason: "",
  check: false,
  claimableDraw: "",
  white: seat("white"),
  black: seat("black"),
  me: "acct-alice",
  myColor: "",
  myTurn: false,
  drawOfferFrom: "",
  players: [],
  gamesPlayed: 1,
};

/** A table whose event stream stays open until aborted (`open`), or closes at once. */
function fakeTable({ open, refuse = false }: { open: boolean; refuse?: boolean }) {
  const fake = {
    call: vi.fn(async () => {
      if (refuse) throw new Error("SeatTaken");
      return { index: 2, result: null as unknown, events: [] };
    }),
    view: vi.fn(async () => ({ index: 1, result: TABLE as unknown })),
    events: vi.fn(async function* (_app: string, _from: number, signal?: AbortSignal) {
      if (open) await new Promise((resolve) => signal?.addEventListener("abort", resolve));
      yield* [];
    }),
  };
  return { fake, client: withRoutes(fake) };
}

const reads = (view: ReturnType<typeof vi.fn>) => view.mock.calls.length;

describe("useChessTable", () => {
  it("leaves the read after a call to the open event stream", async () => {
    const { fake, client } = fakeTable({ open: true });
    const { result } = renderHook(() => useChessTable({ client, appId: "app-1" }));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await waitFor(() => expect(fake.events).toHaveBeenCalled());
    const before = reads(fake.view);
    await act(() => result.current.sit("white", "Ada"));
    expect(fake.call).toHaveBeenCalled();
    expect(reads(fake.view)).toBe(before);
  });

  it("reads again after a refused call", async () => {
    const { fake, client } = fakeTable({ open: true, refuse: true });
    const { result } = renderHook(() => useChessTable({ client, appId: "app-1" }));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await waitFor(() => expect(fake.events).toHaveBeenCalled());
    const before = reads(fake.view);
    await act(() => result.current.sit("white", "Ada"));
    expect(reads(fake.view)).toBe(before + 1);
    expect(result.current.error).toBeTruthy();
  });

  it("reads again after a call while no stream is open", async () => {
    const { fake, client } = fakeTable({ open: false });
    const { result } = renderHook(() => useChessTable({ client, appId: "app-1" }));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await waitFor(() => expect(fake.events).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = reads(fake.view);
    await act(() => result.current.sit("white", "Ada"));
    expect(reads(fake.view)).toBe(before + 1);
  });
});
