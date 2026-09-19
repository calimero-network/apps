import { describe, expect, it } from "vitest";
import {
  claimLabel,
  glyphFor,
  isDarkSquare,
  movePairs,
  movableSquares,
  pieceName,
  piecesFromFen,
  promotionsFor,
  shortId,
  squareIndex,
  squareName,
  statusLine,
  targetsFrom,
} from "./board";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("square numbering", () => {
  it("round-trips every square", () => {
    for (let i = 0; i < 64; i += 1) {
      expect(squareIndex(squareName(i))).toBe(i);
    }
  });

  it("agrees with the contract on the corners", () => {
    // a1 = 0 and h8 = 63 is the contract's numbering. If these two ever
    // disagree, every move the board sends is mirrored.
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
    expect(squareIndex("e4")).toBe(28);
  });

  it("rejects things that are not squares", () => {
    expect(squareIndex("e9")).toBeNull();
    expect(squareIndex("i1")).toBeNull();
    expect(squareIndex("e")).toBeNull();
  });

  it("colours the board with a1 dark", () => {
    expect(isDarkSquare(squareIndex("a1") ?? -1)).toBe(true);
    expect(isDarkSquare(squareIndex("h1") ?? -1)).toBe(false);
    expect(isDarkSquare(squareIndex("a8") ?? -1)).toBe(false);
  });
});

describe("reading a FEN", () => {
  it("places the opening array", () => {
    const squares = piecesFromFen(START);
    expect(squares[squareIndex("e1") ?? 0]).toEqual({ color: "white", kind: "k" });
    expect(squares[squareIndex("d8") ?? 0]).toEqual({ color: "black", kind: "q" });
    expect(squares[squareIndex("a2") ?? 0]).toEqual({ color: "white", kind: "p" });
    expect(squares[squareIndex("e4") ?? 0]).toBeNull();
    expect(squares.filter(Boolean)).toHaveLength(32);
  });

  it("handles a sparse position and ignores the fields after the placement", () => {
    const squares = piecesFromFen("8/8/8/4k3/8/8/4P3/4K3 w - - 12 34");
    expect(squares.filter(Boolean)).toHaveLength(3);
    expect(squares[squareIndex("e5") ?? 0]).toEqual({ color: "black", kind: "k" });
  });

  it("draws an empty board rather than throwing on a malformed FEN", () => {
    // A render must not be the place a bad string surfaces: the status line
    // still says what is happening, and the board simply shows nothing.
    expect(piecesFromFen("this is not a fen").filter(Boolean)).toHaveLength(0);
    expect(piecesFromFen("").filter(Boolean)).toHaveLength(0);
  });

  it("names and draws its pieces", () => {
    expect(glyphFor({ color: "white", kind: "n" })).toBe("♘");
    expect(glyphFor({ color: "black", kind: "k" })).toBe("♚");
    expect(pieceName({ color: "black", kind: "r" })).toBe("black rook");
  });
});

describe("slicing the contract's legal-move list", () => {
  const legal = ["e2e4", "e2e3", "g1f3", "g1h3", "b1a3"];

  it("finds the squares a player may pick up", () => {
    expect(movableSquares(legal)).toEqual(new Set(["e2", "g1", "b1"]));
  });

  it("finds where a picked-up piece may go", () => {
    expect(targetsFrom(legal, "e2")).toEqual(new Set(["e4", "e3"]));
    expect(targetsFrom(legal, "a1")).toEqual(new Set());
  });

  it("offers promotions queen-first, and only for a promoting move", () => {
    const promo = ["a7a8q", "a7a8r", "a7a8b", "a7a8n", "b2b3"];
    expect(promotionsFor(promo, "a7", "a8")).toEqual(["q", "r", "b", "n"]);
    expect(promotionsFor(promo, "b2", "b3")).toEqual([]);
  });

  it("does not confuse a four-character move with a promotion", () => {
    // `promotionsFor` deciding a plain move is a promotion would pop a dialog
    // on every move; deciding a promotion is plain would send `a7a8` and let
    // the contract queen by default, silently taking the choice away.
    expect(promotionsFor(["a7a8"], "a7", "a8")).toEqual([]);
  });
});

describe("the scoresheet", () => {
  it("pairs plies into numbered moves", () => {
    expect(movePairs(["e4", "e5", "Nf3", "Nc6", "Bb5"])).toEqual([
      { number: 1, white: "e4", black: "e5" },
      { number: 2, white: "Nf3", black: "Nc6" },
      { number: 3, white: "Bb5", black: "" },
    ]);
  });

  it("has no rows for a game with no moves", () => {
    expect(movePairs([])).toEqual([]);
  });
});

describe("the status line", () => {
  const base = {
    status: "inProgress",
    result: "*",
    reason: "",
    side_to_move: "white",
    check: false,
    white: { name: "Ada" },
    black: { name: "Bo" },
  };

  it("says whose move it is, and whether they are in check", () => {
    expect(statusLine(base)).toBe("White (Ada) to move.");
    expect(statusLine({ ...base, side_to_move: "black", check: true })).toBe(
      "Black (Bo) is in check.",
    );
  });

  it("names the winner and how they won", () => {
    expect(
      statusLine({ ...base, status: "finished", result: "1-0", reason: "checkmate" }),
    ).toBe("Ada wins — checkmate.");
    expect(
      statusLine({ ...base, status: "finished", result: "0-1", reason: "resignation" }),
    ).toBe("Bo wins — resignation.");
  });

  it("reads a draw as a draw rather than as a win for nobody", () => {
    expect(
      statusLine({ ...base, status: "finished", result: "1/2-1/2", reason: "agreement" }),
    ).toBe("Draw — by agreement.");
    expect(
      statusLine({ ...base, status: "finished", result: "1/2-1/2", reason: "stalemate" }),
    ).toBe("Draw — stalemate.");
  });

  it("waits for players before it says anything about a position", () => {
    expect(statusLine({ ...base, status: "awaitingPlayers" })).toBe(
      "Waiting for both players to sit down.",
    );
  });

  it("falls back to the contract's own word for a reason it does not know", () => {
    // The contract may grow a reason before this table does. Showing the raw
    // token is worse than a sentence and much better than showing nothing.
    expect(
      statusLine({ ...base, status: "finished", result: "1/2-1/2", reason: "adjudicated" }),
    ).toBe("Draw — adjudicated.");
  });
});

describe("small helpers", () => {
  it("labels a claimable draw, and says nothing when there is none", () => {
    expect(claimLabel("threefold")).toBe("Claim draw (threefold repetition)");
    expect(claimLabel("fiftyMove")).toBe("Claim draw (fifty-move rule)");
    expect(claimLabel("")).toBe("");
  });

  it("shortens a member id without mangling a short one", () => {
    expect(shortId("abcdef0123456789abcdef")).toBe("abcdef…cdef");
    expect(shortId("abc")).toBe("abc");
    expect(shortId("")).toBe("");
  });
});
