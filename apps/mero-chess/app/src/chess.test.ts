import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, chess, messageOf, toGameSummary, toTableView, type WireTableView } from "./chess";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
  errors: Record<string, unknown>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

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

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result = method === "table" ? WIRE : method === "history" ? [] : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const c = chess({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    await Promise.all([
      c.table(),
      c.history(),
      c.join("n"),
      c.heartbeat(),
      c.sit("white", "n"),
      c.stand(),
      c.play("e2e4"),
      c.resign(),
      c.offerDraw(),
      c.acceptDraw(),
      c.declineDraw(),
      c.claimDraw(),
      c.rematch(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it("has words for every refusal the contract can answer", () => {
    for (const code of Object.keys(abi.errors)) {
      const e = new AppError("refused", { code, fields: {} });
      expect(messageOf(e), code).not.toBe(code);
    }
  });
});

describe("chess", () => {
  it("sends play's arguments as the contract names them, now as a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 7, result: "e4", events: [] });
    const view = vi.fn().mockResolvedValue({ index: 9, result: WIRE });
    const after = vi.fn();
    const c = chess({ call, view }, "app-1", after, () => 1_700_000_000_123.7);

    expect(await c.play("e2e4")).toBe("e4");
    expect(call).toHaveBeenCalledWith("app-1", "play", { uci: "e2e4", now: "1700000000123" });
    expect(c.index()).toBe(7);
    await c.table();
    expect(view).toHaveBeenCalledWith("app-1", "table", { now: "1700000000123" });
    expect(c.index()).toBe(9);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too, and words the refusal like v1", async () => {
    const after = vi.fn();
    const refusal = new AppError("refused", { code: "NotYourMove", fields: {} });
    const c = chess({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }, "a", after);
    await expect(c.play("e2e4")).rejects.toBe(refusal);
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
