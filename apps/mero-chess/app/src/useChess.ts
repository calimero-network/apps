import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import {
  MeroChessClient,
  type GameSummary,
  type TableView,
} from "./generated/MeroChessClient";

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

/**
 * The generated client, bound to this session.
 *
 * Everything the UI calls goes through `MeroChessClient`, which is generated
 * from `logic/res/abi.json` and regenerated + diffed in CI: a method the
 * contract does not export is a name that does not exist on this object, and
 * `tsc -b` says so rather than the node returning a 500 at play time.
 */
export function useChessClient(contextId: string): MeroChessClient | null {
  const { mero } = useMero();
  return useMemo(() => {
    if (!mero) return null;
    // No executor key is passed: the node derives the caller from the bearer
    // token, and the generated client no longer takes one. The UI never tells
    // the contract who it is — it reads back who the contract says it is, in
    // `TableView.me`.
    return new MeroChessClient(mero, contextId);
  }, [mero, contextId]);
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
 * Events are the fast path — a move shows up in well under a second — but a
 * poll is still needed for two things an event cannot carry: presence, which
 * EXPIRES (nobody emits "I went away"), and a delta that arrived while the SSE
 * stream was reconnecting. Six seconds is frequent enough that the online dots
 * are honest against the contract's thirty-second TTL and rare enough to be
 * invisible next to a chess clock.
 */
const POLL_MS = 6_000;

/**
 * One table, kept current.
 *
 * Reads go through `table()` and nothing else: every field the UI shows is
 * derived by the contract from one replay of the move list, so asking for the
 * pieces and the status separately could paint a board from one moment beside a
 * result from another.
 */
export function useChessTable(contextId: string): ChessTable {
  const client = useChessClient(contextId);
  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A read that is already in flight when an event arrives must not be
  // duplicated — a burst of events (a move plus the ending it caused) would
  // otherwise fire a read per event.
  const reading = useRef(false);

  const refresh = useCallback(async () => {
    if (!client || reading.current) return;
    reading.current = true;
    try {
      setView(await client.table({ now: Date.now() }));
      setError(null);
    } catch (e) {
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

  // An event is a NUDGE, not the truth: the contract's own doc comment says so,
  // and this hook takes it at its word. Nothing is read out of the payload —
  // the arrival of anything for this context means "re-read the table", which
  // cannot be stale in the way a payload can.
  useSubscription(
    useMemo(() => [contextId], [contextId]),
    useCallback(
      (event: SubscriptionEventData) => {
        if ("contextId" in event && event.contextId !== contextId) return;
        void refresh();
      },
      [contextId, refresh],
    ),
  );

  /**
   * Run one contract call, then re-read.
   *
   * There is no optimistic update anywhere in this app. A move is only a move
   * once the contract has taken it, and showing it before then is how a board
   * ends up displaying a position the other player never sees — on the one
   * screen where that is least acceptable.
   */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
        // Deliberately outside the catch: a refused call still moves the
        // player's picture of the table forward (it is not your turn *because*
        // someone else moved), so the refresh has to happen either way.
        reading.current = false;
        await refresh();
      }
    },
    [refresh],
  );

  const call = useCallback(
    <T,>(fn: (client: MeroChessClient) => Promise<T>) =>
      run(async () => {
        if (!client) throw new Error("not connected to a node");
        return fn(client);
      }),
    [client, run],
  );

  return {
    view,
    error,
    busy,
    refresh,
    dismissError: useCallback(() => setError(null), []),
    sit: useCallback(
      (seat, name) => {
        rememberName(name);
        return call((c) => c.sit({ seat, name, now: Date.now() }));
      },
      [call],
    ),
    stand: useCallback(() => call((c) => c.stand({ now: Date.now() })), [call]),
    play: useCallback((uci: string) => call((c) => c.play({ uci, now: Date.now() })), [call]),
    resign: useCallback(() => call((c) => c.resign({ now: Date.now() })), [call]),
    offerDraw: useCallback(() => call((c) => c.offerDraw({ now: Date.now() })), [call]),
    acceptDraw: useCallback(() => call((c) => c.acceptDraw({ now: Date.now() })), [call]),
    declineDraw: useCallback(() => call((c) => c.declineDraw({ now: Date.now() })), [call]),
    claimDraw: useCallback(() => call((c) => c.claimDraw({ now: Date.now() })), [call]),
    rematch: useCallback(() => call((c) => c.rematch({ now: Date.now() })), [call]),
  };
}

/**
 * Every game this table has played.
 *
 * Read separately from `table()`, and only when the table says the answer could
 * have changed — a finished game or a new one. The move list a player is
 * watching updates every few seconds; the record of finished games changes a
 * handful of times an evening, and polling it at the same rate would double
 * this app's RPC traffic to re-read a list that almost never moves.
 */
export function usePastGames(contextId: string, signature: string): GameSummary[] {
  const client = useChessClient(contextId);
  const [games, setGames] = useState<GameSummary[]>([]);

  useEffect(() => {
    if (!client) return;
    let live = true;
    void client
      .history()
      .then((rows) => {
        if (live) setGames(rows);
      })
      .catch(() => {
        // The record is a nicety next to the board. A node that cannot answer
        // this still plays chess, and the error that matters — the one from the
        // player's own call — is already on screen.
      });
    return () => {
      live = false;
    };
    // `signature` is the point: it is what the caller derived from the table,
    // so this re-reads when a game ENDS or a rematch starts and at no other
    // time.
  }, [client, signature]);

  return games;
}

/**
 * Announce this node at the table, so a spectator is visible and a player's
 * presence dot is honest before they have done anything.
 *
 * Separate from `useChessTable` because it is a WRITE, and a hook that writes
 * on mount has to be mounted exactly where that is wanted — once, on the table
 * page — rather than wherever the table happens to be read.
 */
export function useAnnounce(contextId: string, name: string): void {
  const client = useChessClient(contextId);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const key = `${contextId}:${name}`;
    if (announced.current === key) return;
    announced.current = key;
    void client.join({ name: name || "Guest", now: Date.now() }).catch(() => {
      // Presence is a nicety. A node that refuses this — no identity in the
      // context yet, say — still plays chess perfectly well.
    });
  }, [client, contextId, name]);
}

/** A contract refusal is a sentence; anything else gets one. */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong talking to the node.";
}
