import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { chess, messageOf, type Chess, type GameSummary, type TableView } from "./chess";
import { type ClientRoutes } from "@calimero-apps/connect";

/** Where a player's chosen display name lives between visits. */
const NAME_KEY = "mero-chess:name";

export function storedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    // Private mode, or blocked site data. A forgotten name is a smaller
    // problem than a page that will not load.
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* see storedName */
  }
}

/** Where a table lives: the signed-in client and the app instance. */
export interface TableConn {
  client: Pick<CalimeroClient, "events"> & ClientRoutes<{ apps: "call" | "view" }>;
  appId: string;
  /** Runs after every request (keeps the stored session current). */
  after?: () => void;
}

/**
 * The typed contract, bound to this table.
 *
 * Everything the UI calls goes through `chess()` (chess.ts), whose method list
 * `chess.test.ts` checks against the committed `logic/res/abi.json`, and which
 * converts the answers back to the shapes the screens were written against.
 */
export function useChessClient(conn: TableConn): Chess {
  const { client, appId, after } = conn;
  return useMemo(() => chess(client, appId, after), [client, appId, after]);
}

export interface ChessTable {
  /** The whole table, or null until the first read lands. */
  view: TableView | null;
  /** The last error from a read or a call, already turned into a sentence. */
  error: string | null;
  /** True while a call the player made is in flight. */
  busy: boolean;
  refresh: () => Promise<void>;
  /** Clear a refusal the player has read. */
  dismissError: () => void;
  sit: (seat: "white" | "black", name: string) => Promise<void>;
  stand: () => Promise<void>;
  play: (uci: string) => Promise<void>;
  resign: () => Promise<void>;
  offerDraw: () => Promise<void>;
  acceptDraw: () => Promise<void>;
  declineDraw: () => Promise<void>;
  claimDraw: () => Promise<void>;
  rematch: () => Promise<void>;
}

/**
 * How often to re-read the table even when nothing arrived.
 *
 * Events are the fast path, but a poll is still needed for presence, which
 * EXPIRES (nobody emits "I went away"), and for an event stream that was
 * reconnecting. Six seconds keeps the online dots honest against the
 * contract's thirty-second TTL.
 */
const POLL_MS = 6_000;

/**
 * Calls `onEvent` for each event the table emits from log index `from` on,
 * until the returned stop. Every event is a nudge to read `table` again.
 */
function subscribeEvents(
  client: TableConn["client"],
  appId: string,
  from: number,
  onEvent: () => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    try {
      for await (const _event of client.events(appId, from, abort.signal)) onEvent();
    } catch {
      // Stream closed (sign-out, table left, network): the poll still runs.
    }
  })();
  return () => abort.abort();
}

/**
 * One table, kept current.
 *
 * Reads go through `table()` and nothing else: every field the UI shows comes
 * from one replay of the move list, so asking for the pieces and the status
 * separately could paint a board from one moment beside a result from another.
 */
export function useChessTable(conn: TableConn): ChessTable {
  const client = useChessClient(conn);
  const { client: raw, appId } = conn;
  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Coalesced reads: at most one in flight, and one more queued behind it, so
  // a burst of events (a move plus the ending it caused) is two reads at most.
  const reading = useRef(false);
  const again = useRef(false);
  // Whether the error on screen came from a read. A read that succeeds clears
  // only that one: the refusal of a call the player made stays until they
  // dismiss it, although every call is followed by a read.
  const readFailed = useRef(false);

  const refresh = useCallback(async () => {
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        setView(await client.table());
        if (readFailed.current) {
          readFailed.current = false;
          setError(null);
        }
      } while (again.current);
    } catch (e) {
      readFailed.current = true;
      setError(messageOf(e));
    } finally {
      reading.current = false;
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Live events from just after the first read: from index 0 the stream would
  // replay every event the table has ever emitted. An event is a NUDGE, not
  // the truth: nothing is read out of the payload.
  const loaded = view !== null;
  useEffect(() => {
    if (!loaded) return;
    return subscribeEvents(raw, appId, client.index() + 1, () => void refresh());
  }, [raw, appId, client, refresh, loaded]);

  /**
   * Run one contract call, then re-read.
   *
   * There is no optimistic update anywhere in this app. A move is only a move
   * once the contract has taken it.
   */
  const run = useCallback(
    async (fn: (c: Chess) => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      readFailed.current = false;
      try {
        await fn(client);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
        // Outside the catch: a refused call still moves the player's picture
        // of the table forward (it is not your turn *because* someone moved).
        await refresh();
      }
    },
    [client, refresh],
  );

  return {
    view,
    error,
    busy,
    refresh,
    dismissError: useCallback(() => setError(null), []),
    sit: useCallback(
      (seat: "white" | "black", name: string) => {
        rememberName(name);
        return run((c) => c.sit(seat, name));
      },
      [run],
    ),
    stand: useCallback(() => run((c) => c.stand()), [run]),
    play: useCallback((uci: string) => run((c) => c.play(uci)), [run]),
    resign: useCallback(() => run((c) => c.resign()), [run]),
    offerDraw: useCallback(() => run((c) => c.offerDraw()), [run]),
    acceptDraw: useCallback(() => run((c) => c.acceptDraw()), [run]),
    declineDraw: useCallback(() => run((c) => c.declineDraw()), [run]),
    claimDraw: useCallback(() => run((c) => c.claimDraw()), [run]),
    rematch: useCallback(() => run((c) => c.rematch()), [run]),
  };
}

/**
 * Every game this table has played.
 *
 * Read separately from `table()`, and only when the table says the answer could
 * have changed: a finished game or a new one.
 */
export function usePastGames(conn: TableConn, signature: string): GameSummary[] {
  const client = useChessClient(conn);
  const [games, setGames] = useState<GameSummary[]>([]);

  useEffect(() => {
    let live = true;
    void client
      .history()
      .then((rows) => {
        if (live) setGames(rows);
      })
      .catch(() => {
        // The record is a nicety next to the board.
      });
    return () => {
      live = false;
    };
    // `signature` is the point: it re-reads when a game ENDS or a rematch
    // starts and at no other time.
  }, [client, signature]);

  return games;
}

/**
 * Announce this player at the table, so a spectator is visible and a player's
 * presence dot is honest before they have done anything.
 */
export function useAnnounce(conn: TableConn, name: string): void {
  const client = useChessClient(conn);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const key = `${conn.appId}:${name}`;
    if (announced.current === key) return;
    announced.current = key;
    void client.join(name || "Guest").catch(() => {
      // Presence is a nicety: a table that refuses it still plays chess.
    });
  }, [client, conn.appId, name]);
}
