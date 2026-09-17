/**
 * Mero Chess — a small, real board with a move list beside it.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows the actual thing the app shows, the way the other animations in this
 * fleet do: a legal position (after 1.e4 e5 2.Nf3 Nc6 3.Bb5, the Ruy Lopez),
 * the last move lit on both of its squares, and the scoresheet that IS the
 * game's stored state. The caption says the one claim the app exists to make.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx, which scales the whole box to whatever the frame is.
 */

const CELL = 27;
const BOARD_X = 24;
const BOARD_Y = 46;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** The position after 3.Bb5, as a FEN placement field. */
const PLACEMENT = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R";

const GLYPHS: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** [file, rank, piece] for every man on the board, rank 0 = White's back rank. */
function pieces(): [number, number, string][] {
  const out: [number, number, string][] = [];
  let rank = 7;
  let file = 0;
  for (const char of PLACEMENT) {
    if (char === "/") {
      rank -= 1;
      file = 0;
    } else if (char >= "1" && char <= "8") {
      file += Number(char);
    } else {
      out.push([file, rank, char]);
      file += 1;
    }
  }
  return out;
}

/** Screen position of a square, drawn with rank 8 at the top. */
function at(file: number, rank: number) {
  return { left: BOARD_X + file * CELL, top: BOARD_Y + (7 - rank) * CELL };
}

const MOVES: [string, string][] = [
  ["e4", "e5"],
  ["Nf3", "Nc6"],
  ["Bb5", ""],
];

export default function ChessAnimation() {
  const squares = [];
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const dark = (file + rank) % 2 === 0;
      squares.push(
        <span
          key={`sq-${file}-${rank}`}
          className="cal-lp-a-box"
          style={{
            ...at(file, rank),
            width: CELL,
            height: CELL,
            borderRadius: 0,
            border: 0,
            // Tokens, never literals: a hard-coded board colour is what breaks
            // dark mode on the one element that is meant to look like paper.
            background: dark ? "var(--cal-lp-border)" : "var(--cal-lp-bg-2)",
          }}
        />,
      );
    }
  }

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: BOARD_X, top: 16 }}>
        White to move · game 1
      </span>

      {squares}

      {/* The last move, lit on the square it left and the one it reached —
          which is exactly what the real board does. */}
      <span
        className="cal-lp-a-box cal-lp-a-fill"
        style={{ ...at(5, 0), width: CELL, height: CELL, borderRadius: 0, border: 0, ["--d" as string]: "0.4s", ["--t" as string]: "6s" }}
      />
      <span
        className="cal-lp-a-box cal-lp-a-fill"
        style={{ ...at(1, 4), width: CELL, height: CELL, borderRadius: 0, border: 0, ["--d" as string]: "0.6s", ["--t" as string]: "6s" }}
      />

      {pieces().map(([file, rank, piece]) => {
        const white = piece === piece.toUpperCase();
        const pos = at(file, rank);
        return (
          <span
            key={`p-${file}-${rank}`}
            className="cal-lp-a-txt"
            style={{
              left: pos.left,
              top: pos.top + 4,
              width: CELL,
              textAlign: "center",
              fontSize: 19,
              lineHeight: 1,
              color: white ? "var(--cal-lp-text)" : "var(--cal-lp-text-dim)",
            }}
          >
            {GLYPHS[piece]}
          </span>
        );
      })}

      {FILES.map((file, i) => (
        <span
          key={`f-${file}`}
          className="cal-lp-a-txt cal-lp-a-txt--dim"
          style={{ left: BOARD_X + i * CELL, top: BOARD_Y + 8 * CELL + 6, width: CELL, textAlign: "center", fontSize: 8.5 }}
        >
          {file}
        </span>
      ))}

      {/* The scoresheet: the contract's actual state, which is a list of moves
          and nothing else. */}
      <span className="cal-lp-a-pane" style={{ left: 268, top: BOARD_Y, width: 200, height: 8 * CELL }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 284, top: BOARD_Y + 14 }}>
        Moves
      </span>
      {MOVES.map(([white, black], i) => (
        <span key={`m-${i}`}>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 284, top: BOARD_Y + 40 + i * 20 }}>
            {i + 1}.
          </span>
          <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: 310, top: BOARD_Y + 40 + i * 20 }}>
            {white}
          </span>
          <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: 372, top: BOARD_Y + 40 + i * 20 }}>
            {black}
          </span>
        </span>
      ))}
      <span
        className="cal-lp-a-chip cal-lp-a-in"
        style={{ left: 284, top: BOARD_Y + 8 * CELL - 46, ["--d" as string]: "1.2s", ["--t" as string]: "6s" }}
      >
        Bb5 — replicated
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 284, top: BOARD_Y + 8 * CELL - 20, fontSize: 8.5 }}>
        Both nodes replay it
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: BOARD_X, bottom: 4, fontSize: 8.5 }}>
        No game server — the move list is the game, and the rules run in the contract
      </span>
    </div>
  );
}
