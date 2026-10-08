import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import {
  MeroKombatClient,
  type ArenaView,
  type MatchSummary,
} from "./generated/MeroKombatClient";
import type { ArenaState, Slice } from "./game/controller";
import type { MoveKind } from "./game/sim";
import type { FighterId } from "./game/fighters";

const NAME_KEY = "mero-kombat:name";
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

export const storedName = () => read(NAME_KEY);
export const rememberName = (name: string) => write(NAME_KEY, name);
export const storedFighter = (): FighterId => (read(FIGHTER_KEY) as FighterId) || "kinetic";
export const rememberFighter = (id: FighterId) => write(FIGHTER_KEY, id);

/** The generated client, bound to this session. */
export function useKombatClient(contextId: string): MeroKombatClient | null {
  const { mero } = useMero();
  return useMemo(() => (mero ? new MeroKombatClient(mero, contextId) : null), [mero, contextId]);
}

/** The slice of the contract view the fight reads. */
export function toArenaState(v: ArenaView): ArenaState {
  return {
    status: v.status,
    match: v.match_index,
    round: v.round,
    results: v.round_results,
    winner: v.winner,
    flawless: v.flawless,
    names: [v.p1.name, v.p2.name],
    fighters: [v.p1.fighter, v.p2.fighter],
    online: [v.p1.online, v.p2.online],
    hp: [v.p1.hp, v.p2.hp],
    rounds: [v.p1.rounds_won, v.p2.rounds_won],
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

export function useArena(contextId: string) {
  const client = useKombatClient(contextId);
  const { mero } = useMero();
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
    if (!client) return;
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        const started = performance.now();
        const next = await client.arena({ now: Date.now() });
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

  const run = useCallback(
    async (fn: (c: MeroKombatClient) => Promise<unknown>) => {
      if (!client) return;
      setBusy(true);
      setError(null);
      try {
        await fn(client);
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
      if (!client) throw new Error("not connected");
      const start = performance.now();
      meter.sent();
      try {
        await client.act({
          match_index: a.match,
          round: a.round,
          id: a.id,
          kind: a.kind,
          hit: a.hit,
          blocked: a.blocked,
          now: Date.now(),
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
  const ephemeral = mero?.ephemeral;
  const inFlight = useRef(false);
  const queued = useRef<Slice | null>(null);
  const publish = useCallback(
    (slice: Slice) => {
      if (!ephemeral) return;
      if (inFlight.current) {
        queued.current = slice;
        return;
      }
      inFlight.current = true;
      meter.frameOut();
      ephemeral
        .set(contextId, slice)
        .catch(() => {
          /* a dropped frame is replaced 66 ms later */
        })
        .finally(() => {
          inFlight.current = false;
          const next = queued.current;
          queued.current = null;
          if (next) publish(next);
        });
    },
    [ephemeral, contextId, meter],
  );

  const subscribe = useCallback(
    (handler: (s: Slice) => void) => {
      if (!ephemeral) return () => {};
      return ephemeral.subscribe<Slice>(contextId, (entry) => {
        if (entry.removed || !entry.state) return;
        meter.frameIn();
        handler(entry.state);
      });
    },
    [ephemeral, contextId, meter],
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
      (seat: "p1" | "p2", name: string, fighter: FighterId) =>
        run((c) => c.sit({ seat, name, fighter, now: Date.now() })),
      [run],
    ),
    stand: useCallback(() => run((c) => c.stand({ now: Date.now() })), [run]),
    pick: useCallback((fighter: FighterId) => run((c) => c.pick({ fighter, now: Date.now() })), [run]),
    rematch: useCallback(() => run((c) => c.rematch({ now: Date.now() })), [run]),
  };
}

export function usePastMatches(contextId: string, signature: string): MatchSummary[] {
  const client = useKombatClient(contextId);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void client
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

/** Announce this node in the arena once, with a name and a fighter. */
export function useAnnounce(contextId: string, name: string, fighter: FighterId) {
  const client = useKombatClient(contextId);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const key = `${contextId}:${name}`;
    if (done.current === key) return;
    done.current = key;
    void client.join({ name: name || "Fighter", fighter, now: Date.now() }).catch(() => {
      /* presence is a nicety */
    });
    // `fighter` deliberately not a dependency: picking one is its own call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, contextId, name]);
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong talking to the node.";
}
