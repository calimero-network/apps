import { useEffect, useMemo, useRef } from "react";
import { useMero, useSubscription } from "@calimero-network/mero-react";
import { MeroVoteClient } from "./generated/MeroVoteClient";

/** The generated client, bound to this session and context. */
export function useMeroVote(contextId: string): MeroVoteClient | null {
  const { mero } = useMero();
  return useMemo(() => (mero ? new MeroVoteClient(mero, contextId) : null), [mero, contextId]);
}

const COALESCE_MS = 250;
const RESYNC_DELAY_MS = 500;

/**
 * Re-run `refresh` whenever the context changes — a local call, a delta from
 * a peer — and after the event stream reconnects, since nothing replays what
 * happened while it was down. Bursts are coalesced into one read.
 */
export function useLiveRefresh(contextId: string, refresh: () => void): void {
  const { mero } = useMero();
  const ref = useRef(refresh);
  ref.current = refresh;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  useSubscription([contextId], () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      ref.current();
    }, COALESCE_MS);
  });

  useEffect(() => {
    const sse = mero?.events;
    if (!sse) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onConnect = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => ref.current(), RESYNC_DELAY_MS);
    };
    sse.on("connect", onConnect);
    return () => {
      if (t) clearTimeout(t);
      sse.off("connect", onConnect);
    };
  }, [mero]);
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
