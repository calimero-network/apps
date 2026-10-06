import { useEffect, useState } from "react";
import { Piece } from "./pieces";
import {
  FILES,
  isDarkSquare,
  pieceName,
  piecesFromFen,
  promotionsFor,
  squareIndex,
  squareName,
  targetsFrom,
  type PieceColor,
} from "./utils/board";

export interface ChessBoardProps {
  /** The position, as the contract reported it. */
  fen: string;
  /** Every legal move in UCI, from the contract. Empty when it is not your move. */
  legalMoves: string[];
  /** Draw from Black's side of the table. */
  flipped: boolean;
  /** False for a spectator, for the player who is waiting, and for a finished game. */
  interactive: boolean;
  /** The move the player chose, as UCI (with a promotion suffix when promoting). */
  onMove: (uci: string) => void;
  /** Origin and target of the last move played, highlighted. */
  lastMove?: string;
  /** The side whose king is in check, as the contract reported it — lit red. */
  inCheck?: PieceColor;
}

/**
 * The board.
 *
 * Click-to-select rather than drag-and-drop: it is the interaction that works
 * identically with a mouse, a finger and a keyboard, and the one where a
 * mis-drop cannot send a move nobody meant. Selecting a piece asks the
 * CONTRACT's legal-move list where it may go — there is no chess engine in this
 * frontend at all, so the squares the board offers are the squares the node
 * will accept, by construction.
 */
export function ChessBoard({
  fen,
  legalMoves,
  flipped,
  interactive,
  onMove,
  lastMove,
  inCheck,
}: ChessBoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<{
    from: string;
    to: string;
    kinds: string[];
    color: PieceColor;
  } | null>(null);

  const squares = piecesFromFen(fen);
  const targets = selected ? targetsFrom(legalMoves, selected) : new Set<string>();
  const movable = new Set(legalMoves.map((uci) => uci.slice(0, 2)));

  // A selection cannot survive the position changing underneath it: the piece
  // that was selected may have just been captured, and offering its old targets
  // would send a move for a square the player is no longer looking at.
  useEffect(() => {
    setSelected(null);
    setPromoting(null);
  }, [fen, interactive]);

  function choose(square: string) {
    if (!interactive) return;
    if (selected && targets.has(square)) {
      const kinds = promotionsFor(legalMoves, selected, square);
      if (kinds.length > 0) {
        // Ask, rather than assuming a queen. Underpromotion is rare and it is
        // occasionally the only move that wins; a board that silently queens
        // takes that away with no way to notice.
        const mover = squares[squareIndex(selected) ?? -1];
        setPromoting({ from: selected, to: square, kinds, color: mover?.color ?? "white" });
        return;
      }
      onMove(`${selected}${square}`);
      setSelected(null);
      return;
    }
    // Clicking the selected piece again puts it down; clicking another of your
    // own pieces picks that one up instead of being ignored.
    setSelected(selected === square || !movable.has(square) ? null : square);
  }

  // Rank 8 first, so index 0 of the grid is the top-left square — and mirrored
  // when playing Black, because a player reads the board from their own side.
  const order: number[] = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    for (let file = 0; file < 8; file += 1) {
      order.push(rank * 8 + file);
    }
  }
  if (flipped) order.reverse();

  const lastFrom = lastMove?.slice(0, 2);
  const lastTo = lastMove?.slice(2, 4);
  // The edge squares carry the coordinates, inside the board the way every
  // modern board does it — a rank digit down the left, a file letter along the
  // bottom, whichever way round the board is.
  const leftFile = flipped ? 7 : 0;
  const bottomRank = flipped ? 7 : 0;

  return (
    <div className={`board-wrap${promoting ? " is-promoting" : ""}`}>
      <div
        className="board"
        role="grid"
        aria-label="chess board"
        data-orientation={flipped ? "black" : "white"}
      >
        {order.map((index) => {
          const name = squareName(index);
          const piece = squares[index];
          const isTarget = targets.has(name);
          const checked = piece?.kind === "k" && piece.color === inCheck;
          const classes = [
            "square",
            isDarkSquare(index) ? "dark" : "light",
            selected === name ? "selected" : "",
            isTarget ? (piece ? "capture" : "target") : "",
            name === lastFrom || name === lastTo ? "last" : "",
            checked ? "check" : "",
            interactive && movable.has(name) ? "movable" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = piece ? `${name}, ${pieceName(piece)}` : name;
          const file = index % 8;
          const rank = Math.floor(index / 8);
          return (
            <button
              key={name}
              type="button"
              className={classes}
              // The testids are what the Playwright suite drives the game
              // through: a spec that clicked on coordinates would pass against
              // a board rendered upside down.
              data-testid={`square-${name}`}
              aria-label={label}
              // A square with nothing to do is not a tab stop — otherwise
              // reaching the one piece you can move means 30 tab presses.
              disabled={!interactive || (!isTarget && !movable.has(name) && selected === null)}
              onClick={() => choose(name)}
            >
              {file === leftFile && (
                <span className="coord rank" aria-hidden="true">
                  {rank + 1}
                </span>
              )}
              {rank === bottomRank && (
                <span className="coord file" aria-hidden="true">
                  {FILES[file]}
                </span>
              )}
              {piece && <Piece className="piece" color={piece.color} kind={piece.kind} />}
              {isTarget && !piece && <span className="move-hint" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {promoting && (
        <div className="promotion" role="dialog" aria-label="choose a promotion">
          <div className="promotion-card">
            <p className="promotion-title">Promote to</p>
            <div className="promotion-choices">
              {promoting.kinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="promotion-choice"
                  data-testid={`promote-${kind}`}
                  onClick={() => {
                    onMove(`${promoting.from}${promoting.to}${kind}`);
                    setPromoting(null);
                    setSelected(null);
                  }}
                >
                  <Piece className="piece" color={promoting.color} kind={kind} />
                  <span>{PROMOTION_NAMES[kind] ?? kind}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setPromoting(null);
                setSelected(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const PROMOTION_NAMES: Record<string, string> = {
  q: "Queen",
  r: "Rook",
  b: "Bishop",
  n: "Knight",
};

/** Exported for the tests: the squares a click may legally land on. */
export function selectableSquares(legalMoves: string[]): string[] {
  return [...new Set(legalMoves.map((uci) => uci.slice(0, 2)))].sort();
}

/** Exported for the tests: turn a square name into its grid index. */
export { squareIndex };
