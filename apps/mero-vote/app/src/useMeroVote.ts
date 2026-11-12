import { createContext, useContext, useEffect, useRef } from "react";
import { AppError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import type { MeroVoteClient } from "./generated/client";

/**
 * The open voting group, for every screen under it: the typed client bound to
 * the app instance, and its event stream. `App` provides it; the screens read
 * it through the two hooks below, which keep v1's names so they did not have
 * to change.
 */
export interface VoteGroup {
  client: MeroVoteClient;
  /** Calls `onEvent` for each event of the instance until the returned stop. */
  subscribe: (onEvent: () => void) => () => void;
}

export const VoteGroupContext = createContext<VoteGroup | null>(null);

/** The client bound to the open group (`groupId` names it; the provider holds it). */
export function useMeroVote(_groupId: string): MeroVoteClient | null {
  return useContext(VoteGroupContext)?.client ?? null;
}

const COALESCE_MS = 250;
/**
 * Re-read on a timer too, not only on events. An event is a nudge, and a
 * dropped stream (laptop asleep, cluster restarted) would otherwise leave the
 * screen stale with nothing on it saying so.
 */
const POLL_MS = 30_000;

/**
 * Re-run `refresh` whenever the group changes — a write of yours or anyone
 * else's arrives on the instance's event stream — and every 30 s. Bursts are
 * coalesced into one read.
 */
export function useLiveRefresh(_groupId: string, refresh: () => void): void {
  const group = useContext(VoteGroupContext);
  const ref = useRef(refresh);
  ref.current = refresh;

  useEffect(() => {
    if (!group) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = group.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        ref.current();
      }, COALESCE_MS);
    });
    const poll = setInterval(() => ref.current(), POLL_MS);
    return () => {
      stop();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [group]);
}

/**
 * A one-line message for any failure. The contract's errors carry a `message`
 * field (`Phase { message }`, `Forbidden { message }`, …): shown as v1 showed
 * them, `wrong phase: …`; anything else as `describeError` puts it.
 */
export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof AppError) {
    const message = (e.fields as Record<string, unknown>).message;
    const kind = ERROR_PREFIX[e.appCode];
    if (typeof message === "string" && kind) return `${kind}: ${message}`;
    if (e.appCode === "NotFound") return "poll not found";
  }
  return describeError(e);
}

/** v1's `VoteError` display prefixes, by error code. */
const ERROR_PREFIX: Record<string, string> = {
  Invalid: "invalid input",
  Forbidden: "not allowed",
  Phase: "wrong phase",
  Crypto: "crypto",
};

export const short = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
