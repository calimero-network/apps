import { useState } from "react";
import type { GameSummary, TableView } from "./generated/MeroChessClient";
import { claimLabel, movePairs, shortId, statusLine } from "./utils/board";

export interface TablePanelProps {
  view: TableView;
  /** Every game played at this table, current one included. */
  past: GameSummary[];
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

/** The two chairs, with whoever is in them. */
function Seats({ view, busy, name, onNameChange, onSit, onStand }: TablePanelProps) {
  const seated = view.my_color !== "";
  const started = view.moves.length > 0;

  return (
    <div className="card">
      <h2>Players</h2>
      {!seated && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            placeholder="your name"
            aria-label="your name"
            value={name}
            maxLength={32}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>
      )}
      <table>
        <tbody>
          {(["white", "black"] as const).map((color) => {
            const seat = color === "white" ? view.white : view.black;
            const mine = view.my_color === color;
            return (
              <tr key={color} data-testid={`seat-${color}`}>
                <th>
                  <span className={`chip ${color}`} aria-hidden="true" />
                  {color === "white" ? "White" : "Black"}
                </th>
                <td>
                  {seat.member ? (
                    <>
                      <span className={seat.online ? "dot online" : "dot"} aria-hidden="true" />
                      {seat.name || shortId(seat.member)}
                      {mine && <span className="empty"> — you</span>}
                    </>
                  ) : (
                    <span className="empty">empty</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {/* An empty chair is offered even to someone already in the
                      other one: taking both is pass-and-play, which is how this
                      app is useful before anyone else has a node — and the
                      contract allows it deliberately. */}
                  {!seat.member && (
                    <button
                      disabled={busy}
                      data-testid={`sit-${color}`}
                      onClick={() => onSit(color)}
                    >
                      {seated ? "Play this side too" : "Sit here"}
                    </button>
                  )}
                  {/* Standing up is only offered while it is actually allowed.
                      Once a game has a move in it the way out is resignation,
                      and the contract refuses anything else — so offering the
                      button would be offering a refusal. */}
                  {mine && !started && (
                    <button className="ghost" disabled={busy} onClick={onStand}>
                      Stand
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/*
        The seat you take is your colour in THIS game and the opposite one in
        the next — said here rather than left to be discovered after a rematch
        flips the board.
      */}
      <p className="empty" style={{ marginTop: 10 }}>
        Colours swap on every rematch. Take both chairs to play the board
        yourself.
      </p>
    </div>
  );
}

/** Resign, draws, rematch — everything that is not a move. */
function Controls(props: TablePanelProps) {
  const { view, busy } = props;
  const [confirmResign, setConfirmResign] = useState(false);
  const seated = view.my_color !== "";
  const playing = view.status === "inProgress" && seated;
  const offerFromOpponent =
    view.draw_offer_from !== "" && view.draw_offer_from !== view.me;
  const myOfferStands = view.draw_offer_from === view.me && view.me !== "";
  const claim = claimLabel(view.claimable_draw);

  if (!seated) {
    return (
      <div className="card">
        <h2>Watching</h2>
        <p className="empty">
          You are not in either chair, so you are watching this game. The moves
          arrive as the players make them — nothing is hidden from a spectator,
          because chess is a game of complete information.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Game</h2>
      {offerFromOpponent && (
        <div className="offer" data-testid="draw-offer">
          <p>Your opponent offers a draw.</p>
          <div className="row">
            <button disabled={busy} onClick={props.onAcceptDraw} data-testid="accept-draw">
              Accept
            </button>
            <button className="ghost" disabled={busy} onClick={props.onDeclineDraw}>
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="row">
        {playing && !myOfferStands && !offerFromOpponent && (
          <button className="ghost" disabled={busy} onClick={props.onOfferDraw}>
            Offer draw
          </button>
        )}
        {playing && myOfferStands && (
          <span className="empty" data-testid="offer-pending">
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
              Resign
            </button>
          ))}
        {view.status === "finished" && (
          <button disabled={busy} onClick={props.onRematch} data-testid="rematch">
            Rematch
          </button>
        )}
      </div>
    </div>
  );
}

/** The scoresheet. */
function Moves({ view }: { view: TableView }) {
  const rows = movePairs(view.moves.map((m) => m.san));
  return (
    <div className="card">
      <h2>Moves</h2>
      {rows.length === 0 ? (
        <p className="empty">No moves yet.</p>
      ) : (
        <ol className="scoresheet" data-testid="scoresheet">
          {rows.map((row) => (
            <li key={row.number}>
              <span className="num">{row.number}.</span>
              <span className="san">{row.white}</span>
              <span className="san">{row.black}</span>
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
function PastGames({ view, past }: { view: TableView; past: GameSummary[] }) {
  const finished = past.filter((game) => game.result !== "*");
  if (finished.length === 0) return null;
  return (
    <div className="card">
      <h2>Record</h2>
      <table data-testid="record">
        <tbody>
          {[...finished].reverse().map((game) => (
            <tr key={game.index}>
              <th>Game {game.index + 1}</th>
              <td className="mono">{game.result}</td>
              <td className="empty">{RESULT_WORDS[game.reason] ?? game.reason}</td>
              <td className="empty" style={{ textAlign: "right" }}>
                {game.plies} plies
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Named from the SEATS rather than the colours, because the colours swap
          every game and a column headed "White" would mean a different person
          on every row. */}
      <p className="empty" style={{ marginTop: 10 }}>
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
};

/**
 * Everything beside the board: who is playing, where the game stands, the
 * buttons that are not moves, and the scoresheet.
 */
export function TablePanel(props: TablePanelProps) {
  const { view } = props;
  return (
    <div className="panel">
      <div className="card">
        <h2>{view.title}</h2>
        <p className="status" data-testid="status">
          {statusLine(view)}
        </p>
        <p className="empty">
          Game {view.game + 1} of {view.games_played}
          {view.result !== "*" && ` · ${view.result}`}
        </p>
      </div>
      <Seats {...props} />
      <Controls {...props} />
      <Moves view={view} />
      <PastGames view={view} past={props.past} />
    </div>
  );
}
