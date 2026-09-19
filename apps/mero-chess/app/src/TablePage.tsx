import { useState } from "react";
import { clearContextId } from "@calimero-network/mero-react";
import { ChessBoard } from "./ChessBoard";
import { InviteCard } from "./InviteCard";
import { TablePanel } from "./TablePanel";
import { rememberName, storedName, useAnnounce, useChessTable, usePastGames } from "./useChess";

/**
 * One chess table: the board, who is at it, and the link that brings someone
 * else to it.
 *
 * Everything on this page is derived from a single `table()` read — see
 * `useChessTable`. Nothing here decides a rule, computes a position or works
 * out whose turn it is; the contract answers all three and this renders the
 * answer.
 */
export function TablePage({ contextId }: { contextId: string }) {
  const table = useChessTable(contextId);
  const [name, setName] = useState(storedName);
  useAnnounce(contextId, name);

  function switchTable() {
    // A reload rather than local state: the provider reads the stored context
    // on mount, so reloading is what makes the provider and the UI agree
    // instead of duplicating that logic here.
    clearContextId();
    window.location.reload();
  }

  const view = table.view;
  // Re-read the record only when the table says it could have changed: a game
  // ending, or a rematch starting. See `usePastGames`.
  const past = usePastGames(contextId, `${view?.games_played ?? 0}:${view?.result ?? ""}`);

  return (
    <div className="table-page">
      <div className="card context-bar">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="empty">
            Table <code className="mono">{contextId}</code>
          </span>
          <button className="ghost" onClick={switchTable}>
            Change table
          </button>
        </div>
      </div>

      {table.error && (
        <div className="card">
          {/*
            A refusal from the contract is shown verbatim. Every one of them is
            a sentence written for a player ("it is not your move", "that seat
            is taken"), and rewriting them here would put a second, drifting
            copy of the rules in the frontend.
          */}
          <pre className="err" data-testid="error">
            {table.error}
          </pre>
          <button className="ghost" onClick={table.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      {!view ? (
        <div className="card">
          <p className="empty">Reading the table…</p>
        </div>
      ) : (
        <>
          <div className="layout">
            <ChessBoard
              fen={view.fen}
              legalMoves={view.legal_moves}
              // A player sees the board from their own side; a spectator sees
              // it from White's, which is how a game is published.
              //
              // ⚠️ Not simply `my_color === "black"`. In a pass-and-play game
              // one person holds BOTH chairs and `my_color` follows the side to
              // move, so that test would spin the board a full 180° after every
              // single move. Someone playing both sides sits on one side of the
              // table, so the board stays put.
              flipped={view.black.member === view.me && view.white.member !== view.me}
              // The contract sends an empty legal-move list when it is not your
              // move or the game is over, so this is belt-and-braces rather
              // than a second rule: it stops the board from even looking
              // clickable.
              interactive={view.my_turn && !table.busy}
              lastMove={view.moves.at(-1)?.uci}
              onMove={(uci) => void table.play(uci)}
            />
            <TablePanel
              view={view}
              past={past}
              busy={table.busy}
              name={name}
              onNameChange={(next) => {
                setName(next);
                rememberName(next);
              }}
              onSit={(seat) => void table.sit(seat, name)}
              onStand={() => void table.stand()}
              onResign={() => void table.resign()}
              onOfferDraw={() => void table.offerDraw()}
              onAcceptDraw={() => void table.acceptDraw()}
              onDeclineDraw={() => void table.declineDraw()}
              onClaimDraw={() => void table.claimDraw()}
              onRematch={() => void table.rematch()}
            />
          </div>
          <InviteCard contextId={contextId} />
        </>
      )}
    </div>
  );
}
