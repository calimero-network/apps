import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { indexed, messageOf, now, toGameSummary, toTableView, type WireTableView } from "./chess";
import { MeroChessClient } from "./generated/client";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  errors: Record<string, unknown>;
};


const SEAT = { seat: "white", member: "acct-a", name: "Alice", online: true };

const WIRE: WireTableView = {
  title: "Chess",
  createdAt: "1700000000000",
  game: 1,
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  sideToMove: "black",
  moves: [{ ply: 0, uci: "e2e4", san: "e4", by: "acct-a", at: "1700000000001" }],
  legalMoves: ["e7e5"],
  status: "inProgress",
  result: "*",
  reason: "",
  check: false,
  claimableDraw: "",
  white: SEAT,
  black: { ...SEAT, seat: "black", member: "acct-b", name: "Bob" },
  me: "acct-a",
  myColor: "white",
  myTurn: false,
  drawOfferFrom: "acct-b",
  players: [{ id: "acct-a", name: "Alice", online: true, color: "white" }],
  gamesPlayed: 2,
};

describe("the contract's refusals", () => {
  it("has words for every refusal the contract can answer", () => {
    for (const code of Object.keys(abi.errors)) {
      const e = new AppError("refused", { code, fields: {} });
      expect(messageOf(e), code).not.toBe(code);
    }
  });
});

describe("calling the table", () => {
  it("sends `now` as a decimal string and notes the log index of every answer", async () => {
    const call = vi.fn().mockResolvedValue({ index: 7, result: "e4", events: [] });
    const view = vi.fn().mockResolvedValue({ index: 9, result: WIRE });
    const after = vi.fn();
    const watched = indexed(withRoutes({ call, view }));
    const c = new MeroChessClient(watched.transport, "app-1", { after });
    const clock = () => 1_700_000_000_123.7;

    expect(watched.index()).toBe(0);
    expect(await c.play({ uci: "e2e4", now: now(clock) })).toBe("e4");
    expect(call).toHaveBeenCalledWith("app-1", "play", { uci: "e2e4", now: "1700000000123" });
    expect(watched.index()).toBe(7);
    expect(toTableView((await c.table({ now: now(clock) })) as WireTableView).my_color).toBe("white");
    expect(view).toHaveBeenCalledWith("app-1", "table", { now: "1700000000123" });
    expect(watched.index()).toBe(9);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too, and words the refusal like v1", async () => {
    const after = vi.fn();
    const refusal = new AppError("refused", { code: "NotYourMove", fields: {} });
    const c = new MeroChessClient(withRoutes({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }), "a", { after });
    await expect(c.play({ uci: "e2e4", now: now() })).rejects.toBe(refusal);
    expect(after).toHaveBeenCalledTimes(1);
    expect(messageOf(refusal)).toBe("it is not your move");
    expect(messageOf(new Error("boom"))).toBe("boom");
  });
});

describe("the adapter back to the screens' shapes", () => {
  it("turns the camelCase table into v1's snake_case one, u64s into numbers", () => {
    const v = toTableView(WIRE);
    expect(v.created_at).toBe(1_700_000_000_000);
    expect(v.side_to_move).toBe("black");
    expect(v.legal_moves).toEqual(["e7e5"]);
    expect(v.claimable_draw).toBe("");
    expect(v.my_color).toBe("white");
    expect(v.my_turn).toBe(false);
    expect(v.draw_offer_from).toBe("acct-b");
    expect(v.games_played).toBe(2);
    expect(v.moves).toEqual([{ ply: 0, uci: "e2e4", san: "e4", by: "acct-a", at: 1_700_000_000_001 }]);
    expect(v.white).toEqual(SEAT);
  });

  it("converts a game summary", () => {
    expect(
      toGameSummary({ index: 0, startedAt: "5", result: "1-0", reason: "checkmate", plies: 7, white: "a", black: "b" }),
    ).toEqual({ index: 0, started_at: 5, result: "1-0", reason: "checkmate", plies: 7, white: "a", black: "b" });
  });
});
