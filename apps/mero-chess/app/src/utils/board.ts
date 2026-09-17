/**
 * Everything the board needs to draw itself, and nothing that decides a move.
 *
 * ⚠️ There is no chess engine in this frontend, on purpose. The contract is the
 * only implementation of the rules in this app: it hands back `legalMoves` as
 * UCI strings with every read of the table, and the functions here only slice
 * that list up for highlighting. A second engine in TypeScript could disagree
 * with the first one, and the disagreement would show up as a move the board
 * offers and the node then refuses — the worst possible place to find it.
 *
 * Everything in this file is pure, so it is unit-tested without React, without
 * a node, and without a network.
 */

/** a1 = 0 … h8 = 63, the same numbering the contract uses. */
export type SquareIndex = number;

export type PieceColor = "white" | "black";

export interface Piece {
  color: PieceColor;
  /** Lowercase FEN letter: p n b r q k. */
  kind: string;
}

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** `28` -> `"e4"`. */
export function squareName(index: SquareIndex): string {
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}`;
}

/** `"e4"` -> `28`, or `null` for anything that is not a square. */
export function squareIndex(name: string): SquareIndex | null {
  if (name.length !== 2) return null;
  const file = FILES.indexOf(name[0] as (typeof FILES)[number]);
  const rank = Number(name[1]) - 1;
  if (file < 0 || !Number.isInteger(rank) || rank < 0 || rank > 7) return null;
  return rank * 8 + file;
}

/** Dark squares are the ones a1 belongs to. Used for the checkerboard only. */
export function isDarkSquare(index: SquareIndex): boolean {
  return ((index % 8) + Math.floor(index / 8)) % 2 === 0;
}

/**
 * The placement half of a FEN, as 64 squares indexed a1 … h8.
 *
 * Only the first field is read. The rest of the FEN (side to move, castling,
 * the clocks) is already in the table view as its own fields, so parsing it
 * again here would be a second source of truth for the same facts.
 */
export function piecesFromFen(fen: string): (Piece | null)[] {
  const squares: (Piece | null)[] = Array.from({ length: 64 }, () => null);
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  let rank = 7;
  let file = 0;
  for (const char of placement) {
    if (char === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    if (char >= "1" && char <= "8") {
      file += Number(char);
      continue;
    }
    // Anything that is not a piece letter, and any placement that runs off the
    // board, draws an EMPTY board rather than throwing inside a render — and
    // rather than treating the stray character as a piece, which is how
    // `"this is not a fen"` ended up with a rook on it. The status text still
    // tells the player what is going on.
    const kind = char.toLowerCase();
    if (rank < 0 || rank > 7 || file > 7 || !"pnbrqk".includes(kind)) {
      return Array.from({ length: 64 }, () => null);
    }
    squares[rank * 8 + file] = {
      color: char === char.toUpperCase() ? "white" : "black",
      kind,
    };
    file += 1;
  }
  return squares;
}

const GLYPHS: Record<PieceColor, Record<string, string>> = {
  white: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  black: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

/**
 * The Unicode chess glyph for a piece.
 *
 * Text rather than images: it scales to any board size, needs no asset
 * pipeline, and inherits the page's own colours. The CSS gives both sides a
 * fill and a stroke so the black and white glyphs stay legible on both square
 * colours, which a raw glyph does not manage on its own.
 */
export function glyphFor(piece: Piece): string {
  return GLYPHS[piece.color][piece.kind] ?? "";
}

const PIECE_NAMES: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

/** "white knight" — the accessible name for a square's occupant. */
export function pieceName(piece: Piece): string {
  return `${piece.color} ${PIECE_NAMES[piece.kind] ?? "piece"}`;
}

/** The origin squares that have at least one legal move. */
export function movableSquares(legalMoves: string[]): Set<string> {
  return new Set(legalMoves.map((uci) => uci.slice(0, 2)));
}

/** Where a piece on `from` may legally go. */
export function targetsFrom(legalMoves: string[], from: string): Set<string> {
  const targets = new Set<string>();
  for (const uci of legalMoves) {
    if (uci.slice(0, 2) === from) targets.add(uci.slice(2, 4));
  }
  return targets;
}

/**
 * The promotion pieces available for this move, in the order a player expects
 * to be offered them — queen first, because that is what almost every
 * promotion is.
 *
 * An empty array means the move is not a promotion, which is how the board
 * decides whether to ask at all.
 */
export function promotionsFor(legalMoves: string[], from: string, to: string): string[] {
  const order = ["q", "r", "b", "n"];
  const found = legalMoves
    .filter((uci) => uci.length === 5 && uci.slice(0, 4) === `${from}${to}`)
    .map((uci) => uci[4]);
  return order.filter((kind) => found.includes(kind));
}

export interface MovePair {
  /** 1-based move number, as a scoresheet writes it. */
  number: number;
  white: string;
  black: string;
}

/**
 * Turn a flat list of SAN strings into scoresheet rows.
 *
 * Black opening a row happens after a rematch only in principle — a game always
 * starts with White here — but the function still pairs from ply 0, so a caller
 * that hands it a slice does not get a silently shifted scoresheet.
 */
export function movePairs(san: string[]): MovePair[] {
  const rows: MovePair[] = [];
  for (let i = 0; i < san.length; i += 2) {
    rows.push({
      number: i / 2 + 1,
      white: san[i] ?? "",
      black: san[i + 1] ?? "",
    });
  }
  return rows;
}

/** A short, readable form of a member id, for a name nobody supplied. */
export function shortId(id: string): string {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/**
 * The sentence under the board: whose move it is, or how the game ended.
 *
 * Built from the table view's own fields rather than from the FEN, because the
 * contract has already decided all of this and a second opinion here could
 * disagree with the one the other player is looking at.
 */
export function statusLine(view: {
  status: string;
  result: string;
  reason: string;
  side_to_move: string;
  check: boolean;
  white: { name: string };
  black: { name: string };
}): string {
  if (view.status === "awaitingPlayers") {
    return "Waiting for both players to sit down.";
  }
  if (view.status === "finished") {
    const winner =
      view.result === "1-0" ? view.white.name : view.result === "0-1" ? view.black.name : "";
    const how = REASONS[view.reason] ?? view.reason;
    if (view.result === "1/2-1/2") return `Draw — ${how}.`;
    if (winner) return `${winner} wins — ${how}.`;
    return `Game over — ${how}.`;
  }
  const mover = view.side_to_move === "white" ? view.white.name : view.black.name;
  const side = view.side_to_move === "white" ? "White" : "Black";
  return view.check ? `${side} (${mover}) is in check.` : `${side} (${mover}) to move.`;
}

const REASONS: Record<string, string> = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  insufficientMaterial: "neither side can mate",
  fivefold: "fivefold repetition",
  seventyFiveMove: "the seventy-five-move rule",
  resignation: "resignation",
  agreement: "by agreement",
  threefold: "threefold repetition",
  fiftyMove: "the fifty-move rule",
};

/** The label on the claim-a-draw button, or `""` when there is nothing to claim. */
export function claimLabel(claimable: string): string {
  if (claimable === "threefold") return "Claim draw (threefold repetition)";
  if (claimable === "fiftyMove") return "Claim draw (fifty-move rule)";
  return "";
}
