import { useMemo, type ReactNode } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { ChessBoard } from "./ChessBoard";
import type { GameSummary, TableView } from "./chess";
import { InviteCard } from "./InviteCard";
import { GameCard, Moves, PastGames, PlayerBar, type TableActions } from "./TablePanel";
import { useAnnounce, useChessTable, usePastGames, type TableConn } from "./useChess";
import { DEFAULT_NAME, shortAccount, useSeatNames } from "./useSeatNames";
import { materialFromSquares, piecesFromFen, type PieceColor } from "./utils/board";

/** The table a `TablePage` shows: the instance, its name, and its organization. */
export interface OpenTable {
  appId: string;
  name: string;
  org: string | null;
}

/**
 * One chess table: the board, who is at it, and the link that brings someone
 * else to it.
 *
 * Everything on this page comes from a single `table()` read (see
 * `useChessTable`). Nothing here decides a rule, computes a position or works
 * out whose turn it is; the contract answers all three and this renders the
 * answer.
 */
export function TablePage({
  client,
  table: opened,
  after,
  passkey,
  onLeave,
}: {
  client: CalimeroClient;
  table: OpenTable;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
  passkey: () => PasskeyProvider;
  /** Back to the lobby. */
  onLeave: () => void;
}) {
  const conn = useMemo<TableConn>(() => ({ client, appId: opened.appId, after }), [client, opened.appId, after]);
  const table = useChessTable(conn);
  // Seats named by the name given at the table, else a short account id.
  const names = useSeatNames(table.view);
  const name = names.name;
  useAnnounce(conn, name);

  const view = names.view;
  // Re-read the record only when the table says it could have changed: a game
  // ending, or a rematch starting. See `usePastGames`.
  const past = usePastGames(conn, `${view?.games_played ?? 0}:${view?.result ?? ""}`);

  return (
    <TableScreen
      view={view}
      past={past}
      error={table.error}
      onDismissError={table.dismissError}
      onSwitchTable={onLeave}
      onMove={(uci) => void table.play(uci)}
      invite={
        <InviteCard
          client={client}
          table={opened}
          passkey={passkey}
          after={after}
          from={inviterLabel(name, client.session?.accountId)}
        />
      }
      busy={table.busy}
      name={name}
      onNameChange={names.changeName}
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

/** How an invite names its sender: the name given at the table, else a short account id. */
function inviterLabel(name: string, accountId: string | undefined): string | null {
  const given = name.trim();
  if (given && given !== DEFAULT_NAME) return given;
  return accountId ? shortAccount(accountId) : null;
}

export interface TableScreenProps extends TableActions {
  view: TableView | null;
  past: GameSummary[];
  error: string | null;
  onDismissError: () => void;
  onSwitchTable: () => void;
  onMove: (uci: string) => void;
  /** The invite card: a slot, because it talks to the cluster on its own. */
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
