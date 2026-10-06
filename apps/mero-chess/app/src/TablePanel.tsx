import { useEffect, useRef, useState } from "react";
import type { GameSummary, TableView } from "./generated/MeroChessClient";
import { Piece } from "./pieces";
import { claimLabel, movePairs, shortId, statusLine, type PieceColor } from "./utils/board";

/** Everything a player can do at the table that is not a move. */
export interface TableActions {
  busy: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onSit: (seat: "white" | "black") => void;
  onStand: () => void;
  onResign: () => void;
  onOfferDraw: () => void;
  onAcceptDraw: () => void;
  onDeclineDraw: () => void;
  onClaimDraw: () => void;
  onRematch: () => void;
}

export interface PlayerBarProps extends TableActions {
  view: TableView;
  color: PieceColor;
  /** Kinds this side has taken, heaviest first. */
  captured: string[];
  /** Points ahead, or 0. */
  lead: number;
}

/**
 * One chair, drawn as the bar above or below the board: who sits there, whether
 * their node is around, what they have taken, and whose move it is.
 *
 * `view.white` is whoever plays White in THIS game — the contract already
 * swapped the chairs for a rematch — so the colour here is always the colour on
 * the board.
 */
export function PlayerBar({ view, color, captured, lead, busy, onSit, onStand }: PlayerBarProps) {
  const seat = color === "white" ? view.white : view.black;
  const mine = view.my_color === color || (seat.member !== "" && seat.member === view.me);
  const seated = view.my_color !== "";
  const started = view.moves.length > 0;
  const toMove = view.status === "inProgress" && view.side_to_move === color;
  const opponent: PieceColor = color === "white" ? "black" : "white";

  return (
    <div
      className={`player-bar${toMove ? " to-move" : ""}${seat.member ? "" : " vacant"}`}
      data-testid={`seat-${color}`}
    >
      <div className={`avatar ${color}`} aria-hidden="true">
        {seat.member ? (seat.name || "?").slice(0, 1).toUpperCase() : <Piece color={color} kind="k" />}
        {seat.member && <span className={seat.online ? "presence online" : "presence"} />}
      </div>

      <div className="player-main">
        <div className="player-name">
          {seat.member ? (
            <>
              <span className="name">{seat.name || shortId(seat.member)}</span>
              {mine && <span className="you"> — you</span>}
            </>
          ) : (
            <span className="name dim">Seat empty</span>
          )}
        </div>
        <div className="player-sub">
          <span className="side-label">{color === "white" ? "White" : "Black"}</span>
          {seat.member && (
            <span className="presence-label">{seat.online ? "online" : "away"}</span>
          )}
          {captured.length > 0 && (
            <span className="captured" aria-label={`${captured.length} captured`}>
              {captured.map((kind, i) => (
                <Piece key={`${kind}-${i}`} className="captured-piece" color={opponent} kind={kind} />
              ))}
              {lead > 0 && <span className="lead">+{lead}</span>}
            </span>
          )}
        </div>
      </div>

      <div className="player-actions">
        {toMove && <span className="turn-pill">To move</span>}
        {/* An empty chair is offered even to someone already in the other one:
            taking both is pass-and-play, which is how this app is useful before
            anyone else has a node — and the contract allows it deliberately. */}
        {!seat.member && (
          <button
            className="small"
            disabled={busy}
            data-testid={`sit-${color}`}
            onClick={() => onSit(color)}
          >
            {seated ? "Play this side too" : "Sit here"}
          </button>
        )}
        {/* Standing up is only offered while it is actually allowed: before the
            table's first game is under way. A chair someone has played from is
            the record of who played, so the contract refuses to free it —
            offering the button would be offering a refusal. */}
        {mine && !started && view.game === 0 && view.status !== "finished" && (
          <button className="ghost small" disabled={busy} onClick={onStand}>
            Stand
          </button>
        )}
      </div>
    </div>
  );
}

/** Resign, draws, rematch — everything that is not a move. */
function Controls({ view, ...props }: TableActions & { view: TableView }) {
  const { busy } = props;
  const [confirmResign, setConfirmResign] = useState(false);
  const seated = view.my_color !== "";
  const playing = view.status === "inProgress" && seated;
  const offerFromOpponent = view.draw_offer_from !== "" && view.draw_offer_from !== view.me;
  const myOfferStands = view.draw_offer_from === view.me && view.me !== "";
  const claim = claimLabel(view.claimable_draw);

  if (!seated) return null;

  return (
    <>
      {offerFromOpponent && (
        <div className="offer" data-testid="draw-offer">
          <p>Your opponent offers a draw.</p>
          <div className="row">
            <button className="small" disabled={busy} onClick={props.onAcceptDraw} data-testid="accept-draw">
              Accept
            </button>
            <button className="ghost small" disabled={busy} onClick={props.onDeclineDraw}>
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="controls">
        {playing && !myOfferStands && !offerFromOpponent && (
          <button className="ghost" disabled={busy} onClick={props.onOfferDraw}>
            <span aria-hidden="true" className="btn-icon">½</span>
            Offer draw
          </button>
        )}
        {playing && myOfferStands && (
          <span className="pending" data-testid="offer-pending">
            Draw offered — waiting for a reply.
          </span>
        )}
        {playing && claim && (
          <button className="ghost" disabled={busy} onClick={props.onClaimDraw}>
            {claim}
          </button>
        )}
        {playing &&
          (confirmResign ? (
            <>
              <button className="danger" disabled={busy} onClick={props.onResign}>
                Confirm — resign
              </button>
              <button className="ghost" disabled={busy} onClick={() => setConfirmResign(false)}>
                Cancel
              </button>
            </>
          ) : (
            // Two-step, because it is the one button in the app that ends a
            // game outright and it sits next to the ones that do not.
            <button
              className="ghost danger-text"
              disabled={busy}
              onClick={() => setConfirmResign(true)}
            >
              <span aria-hidden="true" className="btn-icon">⚑</span>
              Resign
            </button>
          ))}
        {view.status === "finished" && (
          <button disabled={busy} onClick={props.onRematch} data-testid="rematch">
            Rematch
          </button>
        )}
      </div>
    </>
  );
}

/**
 * The headline card: the game's name, the sentence that says where it stands,
 * and the buttons that go with that sentence.
 */
export function GameCard({
  view,
  onSwitchTable,
  ...actions
}: TableActions & { view: TableView; onSwitchTable: () => void }) {
  const seated = view.my_color !== "";
  const finished = view.status === "finished";
  const tone = finished ? "done" : view.check ? "check" : view.my_turn ? "yours" : "waiting";

  return (
    <div className="card game-card">
      <div className="card-head">
        <h2>{view.title}</h2>
        <button className="ghost small" onClick={onSwitchTable}>
          Change table
        </button>
      </div>

      {finished && (
        <div className="result" aria-hidden="true">
          <span className="score">{view.result.replace("1/2", "½")}</span>
        </div>
      )}

      <div className={`status-row ${tone}`}>
        <span className="status-dot" aria-hidden="true" />
        <p className="status" data-testid="status">
          {statusLine(view)}
        </p>
      </div>
      <p className="meta">
        Game {view.game + 1} of {view.games_played}
        {view.result !== "*" && ` · ${view.result}`}
        {view.my_turn && " · your move"}
      </p>

      {!seated && (
        <div className="seat-prompt">
          <label className="field">
            <span>Your name</span>
            <input
              placeholder="your name"
              aria-label="your name"
              value={actions.name}
              maxLength={32}
              onChange={(e) => actions.onNameChange(e.target.value)}
            />
          </label>
          <p className="hint">
            {view.white.member && view.black.member
              ? "Both chairs are taken, so you are watching. Nothing is hidden from a spectator — chess is a game of complete information."
              : "Pick an empty chair beside the board to play. Take both to play the board yourself."}
          </p>
        </div>
      )}

      <Controls view={view} {...actions} />

      {/* The seat you take is your colour in THIS game and the opposite one in
          the next — said here rather than left to be discovered after a rematch
          flips the board. */}
      {seated && <p className="hint">Colours swap on every rematch.</p>}
    </div>
  );
}

/** The scoresheet. */
export function Moves({ view }: { view: TableView }) {
  const rows = movePairs(view.moves.map((m) => m.san));
  const last = view.moves.length - 1;
  const list = useRef<HTMLOListElement>(null);

  // Keep the newest move in view, the way a scoresheet is read mid-game.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.moves.length]);

  return (
    <div className="card moves-card">
      <div className="card-head">
        <h2>Moves</h2>
        {view.moves.length > 0 && <span className="count">{view.moves.length} plies</span>}
      </div>
      {rows.length === 0 ? (
        <p className="empty">No moves yet. White opens.</p>
      ) : (
        <ol className="scoresheet" data-testid="scoresheet" ref={list}>
          {rows.map((row, i) => (
            <li key={row.number}>
              <span className="num">{row.number}</span>
              <span className={`san${i * 2 === last ? " current" : ""}`}>{row.white}</span>
              <span className={`san${i * 2 + 1 === last ? " current" : ""}`}>{row.black}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The finished games, most recent first.
 *
 * Only rendered once there IS a record: a table where the first game is still
 * being played would otherwise carry an empty card saying nothing.
 */
export function PastGames({ view, past }: { view: TableView; past: GameSummary[] }) {
  const finished = past.filter((game) => game.result !== "*");
  if (finished.length === 0) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Record</h2>
        <span className="count">
          {finished.length} {finished.length === 1 ? "game" : "games"}
        </span>
      </div>
      <table className="record" data-testid="record">
        <tbody>
          {[...finished].reverse().map((game) => (
            <tr key={game.index}>
              <th>Game {game.index + 1}</th>
              <td>
                <span className="score-chip">{game.result}</span>
              </td>
              <td className="dim">{RESULT_WORDS[game.reason] ?? game.reason}</td>
              <td className="dim right">{game.plies} plies</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Named from the SEATS rather than the colours, because the colours swap
          every game and a column headed "White" would mean a different person
          on every row. */}
      <p className="hint">
        {view.white.name || "White"} and {view.black.name || "Black"} have played{" "}
        {finished.length} {finished.length === 1 ? "game" : "games"}.
      </p>
    </div>
  );
}

const RESULT_WORDS: Record<string, string> = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  insufficientMaterial: "dead position",
  fivefold: "fivefold repetition",
  seventyFiveMove: "seventy-five-move rule",
  resignation: "resignation",
  agreement: "agreement",
  threefold: "threefold repetition",
  fiftyMove: "fifty-move rule",
  equivocation: "two moves at once",
};
