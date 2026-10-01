import { useEffect, useState } from "react";
import {
  glyphFor,
  isDarkSquare,
  pieceName,
  piecesFromFen,
  promotionsFor,
  squareIndex,
  squareName,
  targetsFrom,
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
}: ChessBoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<{ from: string; to: string; kinds: string[] } | null>(
    null,
  );

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
        setPromoting({ from: selected, to: square, kinds });
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

  return (
    <div className="board-wrap">
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
          const classes = [
            "square",
            isDarkSquare(index) ? "dark" : "light",
            selected === name ? "selected" : "",
            isTarget ? (piece ? "capture" : "target") : "",
            name === lastFrom || name === lastTo ? "last" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = piece ? `${name}, ${pieceName(piece)}` : name;
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
              {piece && (
                <span className={`piece ${piece.color}`} aria-hidden="true">
                  {glyphFor(piece)}
                </span>
              )}
              {isTarget && !piece && <span className="dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/* Coordinates outside the grid, so they are never mistaken for a piece
          and never inflate a square's accessible name. */}
      <div className="files" aria-hidden="true">
        {(flipped ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"]).map(
          (file) => (
            <span key={file}>{file}</span>
          ),
        )}
      </div>

      {promoting && (
        <div className="promotion" role="dialog" aria-label="choose a promotion">
          <span className="empty">Promote to</span>
          {promoting.kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`promote-${kind}`}
              onClick={() => {
                onMove(`${promoting.from}${promoting.to}${kind}`);
                setPromoting(null);
                setSelected(null);
              }}
            >
              <span className="piece white" aria-hidden="true">
                {glyphFor({ color: "white", kind })}
              </span>
              {PROMOTION_NAMES[kind] ?? kind}
            </button>
          ))}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setPromoting(null);
              setSelected(null);
            }}
          >
            Cancel
          </button>
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
