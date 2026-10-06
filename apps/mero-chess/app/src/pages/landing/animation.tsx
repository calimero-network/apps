/**
 * Mero Chess — the real board, a move being played, and the move list that IS
 * the game's stored state arriving on the other player's node.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows the actual thing the app shows, the way the other animations in this
 * fleet do: the same green board and the same piece set as the app, a legal
 * position (the Ruy Lopez, 1.e4 e5 2.Nf3 Nc6 3.Bb5), the bishop travelling
 * f1→b5 with both squares lit, and the scoresheet beside it picking up the move
 * with a "replicated" tick — the one claim the app exists to make.
 *
 * The board keeps its own cream-and-green in both landing themes on purpose: it
 * is the board the app draws, and a board that turned grey in dark mode would
 * be a picture of some other app.
 *
 * Coordinates are literal pixels against a 495px-wide box — see STAGE_DESIGN_W
 * in LandingPage.tsx, which scales the whole box to whatever the frame is.
 *
 * Motion follows the shared rule (see `.cal-lp-a-in` in landing.css): every
 * keyframe ends where it started and nothing uses a fill mode, so a paused
 * animation — reduced motion, a headless capture — shows the finished position
 * rather than a half-played one.
 */
import { Piece } from "../../pieces";

const CELL = 30;
const BOARD_X = 22;
const BOARD_Y = 40;
const PANEL_X = BOARD_X + 8 * CELL + 18;
const PANEL_W = 495 - PANEL_X - 20;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** The position after 3.Bb5, as a FEN placement field. */
const PLACEMENT = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R";

/** The move being animated: the bishop from f1 to b5. */
const FROM = { file: 5, rank: 0 };
const TO = { file: 1, rank: 4 };

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

/**
 * Chess-only motion. Scoped by the `mc-` prefix, and inside `.cal-lp-a`, so the
 * shared play-state rule (`.cal-lp-a * { animation-play-state }`) pauses these
 * exactly like the fleet's own.
 */
const STYLE = `
.mc-board { position: absolute; border-radius: 6px; overflow: hidden; box-shadow: 0 14px 30px -14px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.18); }
.mc-sq { position: absolute; }
.mc-sq--l { background: #ebecd0; }
.mc-sq--d { background: #779556; }
.mc-lit { position: absolute; background: rgba(255,245,70,.5); }
.mc-coord { position: absolute; font: 700 7px/1 var(--cal-lp-font); }
.mc-piece { position: absolute; filter: drop-shadow(0 1.5px 1px rgba(0,0,0,.25)); }
.mc-slide { animation: mc-slide 6s ease-in-out infinite; }
@keyframes mc-slide {
  0%, 100% { transform: none; opacity: 1; }
  4%       { transform: none; opacity: 0; }
  6%       { transform: translate(${(FROM.file - TO.file) * CELL}px, ${(TO.rank - FROM.rank) * CELL}px); opacity: 1; }
  16%      { transform: translate(${(FROM.file - TO.file) * CELL}px, ${(TO.rank - FROM.rank) * CELL}px); }
  30%      { transform: none; }
}
.mc-panel { position: absolute; border-radius: 10px; background: var(--cal-lp-bg-1); border: 1px solid var(--cal-lp-border); box-shadow: var(--cal-lp-shadow-sm); }
.mc-player { position: absolute; display: flex; align-items: center; gap: 8px; font: 600 10.5px/1.2 var(--cal-lp-font); color: var(--cal-lp-text); }
.mc-player small { display: block; font-weight: 500; font-size: 8.5px; color: var(--cal-lp-text-dim); }
.mc-av { position: relative; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; font: 750 10px/1 var(--cal-lp-font); }
.mc-av--w { background: #f4f4ef; color: #1b1d22; box-shadow: 0 0 0 1px var(--cal-lp-border); }
.mc-av--b { background: #2b2f37; color: #f4f4ef; }
.mc-av i { position: absolute; right: -2px; bottom: -2px; width: 7px; height: 7px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 1.5px var(--cal-lp-bg-1); }
.mc-turn { margin-left: auto; padding: 3px 7px; border-radius: 99px; background: var(--cal-lp-accent); color: var(--cal-lp-accent-text); font: 700 8px/1 var(--cal-lp-font); }
.mc-rule { position: absolute; height: 1px; background: var(--cal-lp-border); }
.mc-move { position: absolute; display: grid; grid-template-columns: 18px 1fr 1fr; align-items: center; font: 600 10.5px/1 var(--cal-lp-font); color: var(--cal-lp-text); }
.mc-move span:first-child { color: var(--cal-lp-text-faint); font-weight: 500; font-size: 9px; }
.mc-move b { font-weight: 600; padding: 4px 6px; border-radius: 4px; }
.mc-cur { background: var(--cal-lp-accent-soft); color: var(--cal-lp-accent-ink, var(--cal-lp-text)); }
.mc-tick { position: absolute; display: flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 99px; background: var(--cal-lp-accent-soft); color: var(--cal-lp-text); font: 600 9px/1 var(--cal-lp-font); }
.mc-tick i { width: 12px; height: 12px; border-radius: 50%; background: var(--cal-lp-accent); color: var(--cal-lp-accent-text); display: grid; place-items: center; font: 800 8px/1 var(--cal-lp-font); font-style: normal; }
`;

export default function ChessAnimation() {
  const squares = [];
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const dark = (file + rank) % 2 === 0;
      const pos = at(file, rank);
      squares.push(
        <span
          key={`sq-${file}-${rank}`}
          className={`mc-sq ${dark ? "mc-sq--d" : "mc-sq--l"}`}
          style={{ left: pos.left - BOARD_X, top: pos.top - BOARD_Y, width: CELL, height: CELL }}
        />,
      );
    }
  }

  const lit = (sq: { file: number; rank: number }, delay: string) => {
    const pos = at(sq.file, sq.rank);
    return (
      <span
        className="mc-lit cal-lp-a-blink"
        style={{
          left: pos.left - BOARD_X,
          top: pos.top - BOARD_Y,
          width: CELL,
          height: CELL,
          ["--d" as string]: delay,
          ["--t" as string]: "6s",
        }}
      />
    );
  };

  const moveTop = BOARD_Y + 58;

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <style>{STYLE}</style>

      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: BOARD_X, top: 16 }}>
        Black to move · game 1
      </span>

      <div className="mc-board" style={{ left: BOARD_X, top: BOARD_Y, width: 8 * CELL, height: 8 * CELL }}>
        {squares}
        {/* The last move, lit on the square it left and the one it reached —
            which is exactly what the real board does. */}
        {lit(FROM, "2s")}
        {lit(TO, "2s")}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((rank) => (
          <span
            key={`r-${rank}`}
            className="mc-coord"
            style={{
              left: 2,
              top: (7 - rank) * CELL + 2,
              color: rank % 2 === 0 ? "#ebecd0" : "#779556",
            }}
          >
            {rank + 1}
          </span>
        ))}
        {FILES.map((file, i) => (
          <span
            key={`f-${file}`}
            className="mc-coord"
            style={{ left: i * CELL + CELL - 7, top: 8 * CELL - 9, color: i % 2 === 0 ? "#ebecd0" : "#779556" }}
          >
            {file}
          </span>
        ))}
        {pieces().map(([file, rank, piece]) => {
          const pos = at(file, rank);
          const moving = file === TO.file && rank === TO.rank;
          return (
            <span
              key={`p-${file}-${rank}`}
              className={`mc-piece${moving ? " mc-slide" : ""}`}
              style={{ left: pos.left - BOARD_X, top: pos.top - BOARD_Y, width: CELL, height: CELL }}
            >
              <Piece
                color={piece === piece.toUpperCase() ? "white" : "black"}
                kind={piece.toLowerCase()}
              />
            </span>
          );
        })}
      </div>

      {/* The side panel: the two people, each on their own node, and the
          scoresheet between them — the contract's actual state, which is a
          list of moves and nothing else. */}
      <span className="mc-panel" style={{ left: PANEL_X, top: BOARD_Y, width: PANEL_W, height: 8 * CELL }} />

      <span className="mc-player" style={{ left: PANEL_X + 12, top: BOARD_Y + 12, width: PANEL_W - 24 }}>
        <span className="mc-av mc-av--b">
          M<i />
        </span>
        <span>
          Magnus
          <small>their node</small>
        </span>
        <span className="mc-turn cal-lp-a-in" style={{ ["--d" as string]: "2.2s", ["--t" as string]: "6s" }}>
          To move
        </span>
      </span>
      <span className="mc-rule" style={{ left: PANEL_X + 12, top: BOARD_Y + 46, width: PANEL_W - 24 }} />

      {MOVES.map(([white, black], i) => (
        <span
          key={`m-${i}`}
          className="mc-move"
          style={{ left: PANEL_X + 12, top: moveTop + i * 22, width: PANEL_W - 24 }}
        >
          <span>{i + 1}</span>
          <b
            className={i === MOVES.length - 1 ? "mc-cur cal-lp-a-in" : undefined}
            style={i === MOVES.length - 1 ? { ["--d" as string]: "1.6s", ["--t" as string]: "6s" } : undefined}
          >
            {white}
          </b>
          <b>{black}</b>
        </span>
      ))}

      <span
        className="mc-tick cal-lp-a-in"
        style={{ left: PANEL_X + 12, top: BOARD_Y + 8 * CELL - 86, ["--d" as string]: "2.4s", ["--t" as string]: "6s" }}
      >
        <i>✓</i> Bb5 replicated to Magnus
      </span>

      <span className="mc-rule" style={{ left: PANEL_X + 12, top: BOARD_Y + 8 * CELL - 46, width: PANEL_W - 24 }} />
      <span className="mc-player" style={{ left: PANEL_X + 12, top: BOARD_Y + 8 * CELL - 36, width: PANEL_W - 24 }}>
        <span className="mc-av mc-av--w">
          A<i />
        </span>
        <span>
          Ada
          <small>your node</small>
        </span>
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: BOARD_X, top: BOARD_Y + 8 * CELL + 10, fontSize: 8.5 }}>
        No game server — the move list is the game, and the rules run in the contract on both nodes
      </span>
    </div>
  );
}
