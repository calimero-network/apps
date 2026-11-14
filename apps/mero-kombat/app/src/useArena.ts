import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { MeroKombatClient } from "./generated/client";
import { indexed, messageOf, now, type ArenaView, type MatchSummary } from "./kombat";
import { presencePublisher, subscribePresence } from "./presence";
import type { ArenaState, Slice } from "./game/controller";
import type { MoveKind } from "./game/sim";
import type { FighterId } from "./game/fighters";
import { type ClientRoutes } from "@calimero-apps/connect";

const FIGHTER_KEY = "mero-kombat:fighter";

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a forgotten preference is a smaller problem than a page that will not load */
  }
}

export const storedFighter = (): FighterId => (read(FIGHTER_KEY) as FighterId) || "kinetic";
export const rememberFighter = (id: FighterId) => write(FIGHTER_KEY, id);

/** Where an arena lives: the signed-in client and the app instance. */
export interface ArenaConn {
  client: Pick<CalimeroClient, "events" | "presenceStream"> &
    ClientRoutes<{ apps: "call" | "view" | "presencePublish" }>;
  appId: string;
  /** Runs after every request (keeps the stored session current). */
  after?: () => void;
}

/** The arena's contract, and the highest log index its answers reflected. */
export interface KombatClient {
  kombat: MeroKombatClient;
  index(): number;
}

/**
 * The typed contract, bound to this arena: `MeroKombatClient`, which
 * `meroctl app codegen` writes from the committed `logic/res/abi.json`.
 */
export function useKombatClient(conn: ArenaConn): KombatClient {
  const { client, appId, after } = conn;
  return useMemo(() => {
    const watched = indexed(client);
    return { kombat: new MeroKombatClient(watched.transport, appId, { after }), index: watched.index };
  }, [client, appId, after]);
}

/**
 * Calls `onEvent` for each event the arena emits, from now on, until the
 * returned stop. Every event is a nudge to read `arena` again.
 */
function subscribeEvents(
  client: ArenaConn["client"],
  appId: string,
  from: number,
  onEvent: () => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    try {
      for await (const _event of client.events(appId, from, abort.signal)) onEvent();
    } catch {
      // Stream closed (sign-out, arena left, network): the poll still runs.
    }
  })();
  return () => abort.abort();
}

/** The slice of the contract view the fight reads. */
export function toArenaState(v: ArenaView): ArenaState {
  return {
    status: v.status,
    match: v.matchIndex,
    round: v.round,
    results: v.roundResults,
    winner: v.winner,
    flawless: v.flawless,
    names: [v.p1.name, v.p2.name],
    fighters: [v.p1.fighter, v.p2.fighter],
    online: [v.p1.online, v.p2.online],
    hp: [v.p1.hp, v.p2.hp],
    rounds: [v.p1.roundsWon, v.p2.roundsWon],
    hits: v.hits.map((h) => `${h.by}:${h.id}`),
  };
}

// ── transaction metrics ─────────────────────────────────────────────────────

export interface TxRecord {
  id: number;
  kind: MoveKind;
  hit: boolean;
  blocked: boolean;
  ok: boolean;
  ms: number;
  at: number;
  error?: string;
}

export interface TxStats {
  sent: number;
  ok: number;
  failed: number;
  /** Transactions confirmed per second, over the last five seconds. */
  tps: number;
  /** Highest one-second count this session. */
  peak: number;
  /** Median and 95th-percentile round trip of the last 50, ms. */
  p50: number;
  p95: number;
  /** Confirmed per second, last 60 seconds, oldest first. */
  series: number[];
  recent: TxRecord[];
  /** Presence frames sent and received per second. */
  framesOut: number;
  framesIn: number;
}

const EMPTY_STATS: TxStats = {
  sent: 0,
  ok: 0,
  failed: 0,
  tps: 0,
  peak: 0,
  p50: 0,
  p95: 0,
  series: Array(60).fill(0),
  recent: [],
  framesOut: 0,
  framesIn: 0,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

/**
 * Every transaction this screen sends, timed. Kept in refs and published to
 * React twice a second: a fight sends several a second, and re-rendering the
 * page on each would cost frames on the canvas the transactions came from.
 */
function useTxMeter() {
  const log = useRef<TxRecord[]>([]);
  const confirmedAt = useRef<number[]>([]);
  const counts = useRef({ sent: 0, ok: 0, failed: 0, peak: 0, framesOut: 0, framesIn: 0 });
  const frames = useRef<{ out: number[]; in: number[] }>({ out: [], in: [] });
  const [stats, setStats] = useState<TxStats>(EMPTY_STATS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      confirmedAt.current = confirmedAt.current.filter((t) => now - t < 60_000);
      frames.current.out = frames.current.out.filter((t) => now - t < 2_000);
      frames.current.in = frames.current.in.filter((t) => now - t < 2_000);
      const series = Array.from({ length: 60 }, (_, i) => {
        const from = now - (60 - i) * 1000;
        return confirmedAt.current.filter((t) => t >= from && t < from + 1000).length;
      });
      const last = series[series.length - 1];
      counts.current.peak = Math.max(counts.current.peak, last);
      const recentMs = log.current.filter((r) => r.ok).slice(0, 50).map((r) => r.ms).sort((a, b) => a - b);
      setStats({
        sent: counts.current.sent,
        ok: counts.current.ok,
        failed: counts.current.failed,
        tps: confirmedAt.current.filter((t) => now - t < 5_000).length / 5,
        peak: counts.current.peak,
        p50: percentile(recentMs, 0.5),
        p95: percentile(recentMs, 0.95),
        series,
        recent: log.current.slice(0, 12),
        framesOut: frames.current.out.length / 2,
        framesIn: frames.current.in.length / 2,
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const record = useCallback((r: TxRecord) => {
    if (r.ok) {
      counts.current.ok += 1;
      confirmedAt.current.push(performance.now());
    } else {
      counts.current.failed += 1;
    }
    log.current.unshift(r);
    if (log.current.length > 120) log.current.length = 120;
  }, []);

  const sent = useCallback(() => {
    counts.current.sent += 1;
  }, []);

  const frameOut = useCallback(() => frames.current.out.push(performance.now()), []);
  const frameIn = useCallback(() => frames.current.in.push(performance.now()), []);

  const fns = useMemo(() => ({ record, sent, frameOut, frameIn }), [record, sent, frameOut, frameIn]);
  return { stats, fns };
}

// ── the arena ───────────────────────────────────────────────────────────────

/** Fallback poll — events are the fast path. */
const POLL_MS = 3_000;
/** Floor between two contract reads when events arrive in a burst. */
const MIN_READ_GAP_MS = 160;

export function useArena(conn: ArenaConn) {
  const client = useKombatClient(conn);
  const { client: raw, appId } = conn;
  const [view, setView] = useState<ArenaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { stats, fns: meter } = useTxMeter();

  // Coalesced reads: at most one in flight, and one more queued behind it. A
  // fight emits an event per transaction; a read per event would queue
  // hundreds.
  const reading = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        const started = performance.now();
        const next = await client.kombat.arena({ now: now() });
        setView(next);
        setError(null);
        // At most ~6 reads a second. The fight itself never waits on a read —
        // the bars move from the presence stream — so this only bounds how
        // often the contract's figure is fetched to settle them.
        const rest = MIN_READ_GAP_MS - (performance.now() - started);
        if (again.current && rest > 0) await new Promise((r) => setTimeout(r, rest));
      } while (again.current);
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

  // Live events from just after the first read: from index 0 the stream would
  // replay every blow the arena has ever seen.
  const loaded = view !== null;
  useEffect(() => {
    if (!loaded) return;
    return subscribeEvents(raw, appId, client.index() + 1, () => void refresh());
  }, [raw, appId, client, refresh, loaded]);

  const run = useCallback(
    async (fn: (c: MeroKombatClient) => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn(client.kombat);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [client, refresh],
  );

  /** One fight action → one transaction, timed. */
  const act = useCallback(
    async (a: { match: number; round: number; id: number; kind: MoveKind; hit: boolean; blocked: boolean }) => {
      const start = performance.now();
      meter.sent();
      try {
        await client.kombat.act({
          matchIndex: a.match,
          round: a.round,
          id: a.id,
          kind: a.kind,
          hit: a.hit,
          blocked: a.blocked,
          now: now(),
        });
        const ms = Math.round(performance.now() - start);
        meter.record({ ...a, ok: true, ms, at: Date.now() });
        return ms;
      } catch (e) {
        const ms = Math.round(performance.now() - start);
        meter.record({ ...a, ok: false, ms, at: Date.now(), error: messageOf(e) });
        throw e;
      }
    },
    [client, meter],
  );

  /** Fire-and-forget presence. The newest slice wins; one request at a time. */
  const publish = useMemo(
    () => presencePublisher(raw, appId, meter.frameOut) as (slice: Slice) => void,
    [raw, appId, meter],
  );

  const subscribe = useCallback(
    (handler: (s: Slice) => void) =>
      subscribePresence<Slice>(raw, appId, (slice) => {
        meter.frameIn();
        handler(slice);
      }),
    [raw, appId, meter],
  );

  return {
    view,
    error,
    busy,
    stats,
    refresh,
    dismissError: useCallback(() => setError(null), []),
    act,
    publish,
    subscribe,
    sit: useCallback(
      (seat: "p1" | "p2", name: string, fighter: FighterId) => run((c) => c.sit({ seat, name, fighter, now: now() })),
      [run],
    ),
    stand: useCallback(() => run((c) => c.stand({ now: now() })), [run]),
    pick: useCallback((fighter: FighterId) => run((c) => c.pick({ fighter, now: now() })), [run]),
    rematch: useCallback(() => run((c) => c.rematch({ now: now() })), [run]),
  };
}

export function usePastMatches(conn: ArenaConn, signature: string): MatchSummary[] {
  const client = useKombatClient(conn);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  useEffect(() => {
    let live = true;
    void client.kombat
      .history()
      .then((rows) => {
        if (live) setMatches(rows);
      })
      .catch(() => {
        /* the record is a nicety beside the fight */
      });
    return () => {
      live = false;
    };
  }, [client, signature]);
  return matches;
}

/** Announce this player in the arena once, with a name and a fighter. */
export function useAnnounce(conn: ArenaConn, name: string, fighter: FighterId) {
  const client = useKombatClient(conn);
  const done = useRef<string | null>(null);
  useEffect(() => {
    const key = `${conn.appId}:${name}`;
    if (done.current === key) return;
    done.current = key;
    void client.kombat.join({ name: name || "Fighter", fighter, now: now() }).catch(() => {
      /* presence is a nicety */
    });
    // `fighter` deliberately not a dependency: picking one is its own call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, conn.appId, name]);
}

export { messageOf };
