import { useState, type ReactNode } from "react";
import { clearContextId } from "@calimero-network/mero-react";
import { ChessBoard } from "./ChessBoard";
import type { GameSummary, TableView } from "./generated/MeroChessClient";
import { InviteCard } from "./InviteCard";
import { GameCard, Moves, PastGames, PlayerBar, type TableActions } from "./TablePanel";
import { rememberName, storedName, useAnnounce, useChessTable, usePastGames } from "./useChess";
import { materialFromSquares, piecesFromFen, type PieceColor } from "./utils/board";

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
    <TableScreen
      view={view}
      past={past}
      error={table.error}
      onDismissError={table.dismissError}
      onSwitchTable={switchTable}
      onMove={(uci) => void table.play(uci)}
      invite={<InviteCard contextId={contextId} />}
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
  );
}

export interface TableScreenProps extends TableActions {
  view: TableView | null;
  past: GameSummary[];
  error: string | null;
  onDismissError: () => void;
  onSwitchTable: () => void;
  onMove: (uci: string) => void;
  /** The invite card — a slot, because it reads the node on its own. */
  invite: ReactNode;
}

/**
 * The table, drawn from props alone: board between the two player bars, the
 * game and the scoresheet beside it. Split from `TablePage` so the layout has
 * no hooks into the node and renders the same from any `TableView`.
 */
export function TableScreen({
  view,
  past,
  error,
  onDismissError,
  onSwitchTable,
  onMove,
  invite,
  ...actions
}: TableScreenProps) {
  return (
    <div className="table-page">
      {error && (
        <div className="card alert" role="alert">
          {/*
            A refusal from the contract is shown verbatim. Every one of them is
            a sentence written for a player ("it is not your move", "that seat
            is taken"), and rewriting them here would put a second, drifting
            copy of the rules in the frontend.
          */}
          <pre className="err" data-testid="error">
            {error}
          </pre>
          <button className="ghost small" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      {!view ? (
        <div className="loading-state">
          <span className="spinner" aria-hidden="true" />
          <p className="empty">Reading the table…</p>
        </div>
      ) : (
        <Table view={view} past={past} onSwitchTable={onSwitchTable} onMove={onMove} invite={invite} {...actions} />
      )}
    </div>
  );
}

function Table({
  view,
  past,
  onSwitchTable,
  onMove,
  invite,
  ...actions
}: TableActions & {
  view: TableView;
  past: GameSummary[];
  onSwitchTable: () => void;
  onMove: (uci: string) => void;
  invite: ReactNode;
}) {
  // A player sees the board from their own side; a spectator sees it from
  // White's, which is how a game is published.
  //
  // ⚠️ Not simply `my_color === "black"`. In a pass-and-play game one person
  // holds BOTH chairs and `my_color` follows the side to move, so that test
  // would spin the board a full 180° after every single move. Someone playing
  // both sides sits on one side of the table, so the board stays put.
  const flipped = view.black.member === view.me && view.white.member !== view.me;
  const material = materialFromSquares(piecesFromFen(view.fen));
  const bar = (color: PieceColor) => (
    <PlayerBar
      view={view}
      color={color}
      captured={material.captured[color]}
      lead={material.lead[color]}
      {...actions}
    />
  );

  return (
    <div className="game-layout">
      <section className="board-col" aria-label="board">
        {bar(flipped ? "white" : "black")}
        <ChessBoard
          fen={view.fen}
          legalMoves={view.legal_moves}
          flipped={flipped}
          // The contract sends an empty legal-move list when it is not your
          // move or the game is over, so this is belt-and-braces rather than a
          // second rule: it stops the board from even looking clickable.
          interactive={view.my_turn && !actions.busy}
          lastMove={view.moves.at(-1)?.uci}
          inCheck={view.check ? (view.side_to_move as PieceColor) : undefined}
          onMove={onMove}
        />
        {bar(flipped ? "black" : "white")}
      </section>

      <aside className="side-col">
        <GameCard view={view} onSwitchTable={onSwitchTable} {...actions} />
        <Moves view={view} />
        {invite}
        <PastGames view={view} past={past} />
      </aside>
    </div>
  );
}
