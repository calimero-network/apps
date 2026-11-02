import { useCallback, useEffect, useRef, useState } from "react";

import { maybeConnection, selfAccount } from "./connection";

/**
 * Ephemeral presence in one conversation, on the node's presence API
 * (`publishPresence` / `presenceStream`): what mero-react's `useEphemeral`
 * gave v1. A device publishes a small JSON state (at most 4 KiB); the node
 * drops an entry not refreshed within 7 s, so the latest state is re-sent as a
 * heartbeat. Nothing is written to the app's state or log.
 *
 * `peers` holds every OTHER account's latest state, by account.
 */
export const HEARTBEAT_MS = 4_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function decodeState<T>(hex: string | null): T | null {
  if (!hex) return null;
  try {
    return JSON.parse(decoder.decode(hexToBytes(hex))) as T;
  } catch {
    return null;
  }
}

interface Entry {
  account: string;
  device: string;
  state: string | null;
}

export function useEphemeral<T>(app: string | null): {
  peers: Map<string, T>;
  setPresence: (state: T | null) => void;
  error: Error | null;
} {
  const [peers, setPeers] = useState<Map<string, T>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);
  const last = useRef<Uint8Array | null>(null);

  const send = useCallback(
    (state: Uint8Array | null) => {
      const conn = maybeConnection();
      if (!app || !conn) return;
      conn.client.publishPresence(app, seq.current, state).catch((e: unknown) => {
        setError(e instanceof Error ? e : new Error(String(e)));
      });
    },
    [app],
  );

  const setPresence = useCallback(
    (state: T | null) => {
      seq.current += 1;
      last.current = state === null ? null : encoder.encode(JSON.stringify(state));
      send(last.current);
    },
    [send],
  );

  // Heartbeat: the same seq and state again, while one is published.
  useEffect(() => {
    if (!app) return undefined;
    const timer = setInterval(() => {
      if (last.current) send(last.current);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      if (last.current) {
        last.current = null;
        seq.current += 1;
        send(null);
      }
    };
  }, [app, send]);

  useEffect(() => {
    setPeers(new Map());
    const conn = maybeConnection();
    if (!app || !conn) return undefined;
    const me = selfAccount();
    const abort = new AbortController();
    const byDevice = new Map<string, Entry>();
    const publish = () => {
      const next = new Map<string, T>();
      for (const e of byDevice.values()) {
        if (e.account === me) continue;
        const state = decodeState<T>(e.state);
        if (state !== null) next.set(e.account, state);
      }
      setPeers(next);
    };
    void (async () => {
      try {
        for await (const event of conn.client.presenceStream(app, abort.signal)) {
          if (event.kind === "snapshot") {
            byDevice.clear();
            for (const e of (event.data as Entry[]) ?? []) byDevice.set(`${e.account}/${e.device}`, e);
          } else {
            const e = event.data as Entry;
            if (e.state === null) byDevice.delete(`${e.account}/${e.device}`);
            else byDevice.set(`${e.account}/${e.device}`, e);
          }
          publish();
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => abort.abort();
  }, [app]);

  return { peers, setPresence, error };
}

/** The accounts present in `app` now, polled (no stream): for the sidebar's dots. */
export function usePresentAccounts(app: string | undefined, everyMs = 20_000): Set<string> {
  const [present, setPresent] = useState<Set<string>>(new Set());
  useEffect(() => {
    const conn = maybeConnection();
    if (!app || !conn) return undefined;
    let live = true;
    const poll = () =>
      conn.client
        .presence(app)
        .then((entries) => {
          if (live) setPresent(new Set(entries.filter((e) => e.state !== null).map((e) => e.account)));
        })
        .catch(() => {});
    void poll();
    const timer = setInterval(poll, everyMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [app, everyMs]);
  return present;
}
