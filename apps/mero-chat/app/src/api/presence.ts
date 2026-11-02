/**
 * Who is here, and what they are doing, in one app instance: the node's
 * presence channel (`publishPresence`, `presenceStream`), ephemeral and never
 * part of the app's state. Replaces mero-react's `useEphemeral`, with the same
 * shape: `peers` (account → the slice they publish, others only) and
 * `setPresence`.
 *
 * An entry the node has not had refreshed for 7 s is gone, so the current
 * slice is sent again every few seconds while the hook is mounted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CalimeroClient, PresenceEntry } from "@calimero-network/mero-js";

import { getAccountId, getClient } from "./calimero";

const HEARTBEAT_MS = 3_000;
const RETRY_MS = 3_000;

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** A presence entry's state: hex of the bytes published. */
export function decodeState<T>(hex: string | null): T | null {
  if (!hex) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export interface Ephemeral<T> {
  peers: Map<string, T>;
  setPresence: (value: T) => void;
  error: Error | null;
}

export function useEphemeral<T>(app: string | null): Ephemeral<T> {
  const [peers, setPeers] = useState<Map<string, T>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const current = useRef<T | null>(null);
  const seq = useRef(0);

  const publish = useCallback(
    (value: T | null) => {
      if (!app) return;
      let client: CalimeroClient;
      try {
        client = getClient();
      } catch {
        return;
      }
      seq.current += 1;
      client
        .publishPresence(app, seq.current, value === null ? null : encode(value))
        .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
    },
    [app],
  );

  const setPresence = useCallback(
    (value: T) => {
      current.current = value;
      publish(value);
    },
    [publish],
  );

  // Heartbeat while mounted; retract on leave.
  useEffect(() => {
    if (!app) return undefined;
    const timer = setInterval(() => {
      if (current.current !== null) publish(current.current);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      if (current.current !== null) publish(null);
      current.current = null;
    };
  }, [app, publish]);

  // Everyone else present.
  useEffect(() => {
    setPeers(new Map());
    if (!app) return undefined;
    const ctrl = new AbortController();
    const self = getAccountId();
    const entries = new Map<string, PresenceEntry>();
    const flush = () => {
      const next = new Map<string, T>();
      for (const e of entries.values()) {
        if (e.account === self) continue;
        const state = decodeState<T>(e.state);
        if (state !== null) next.set(e.account, state);
      }
      setPeers(next);
    };
    void (async () => {
      while (!ctrl.signal.aborted) {
        try {
          for await (const event of getClient().presenceStream(app, ctrl.signal)) {
            if (event.kind === "snapshot") {
              entries.clear();
              for (const e of (event.data as PresenceEntry[]) ?? []) entries.set(`${e.account}/${e.device}`, e);
            } else {
              const e = event.data as PresenceEntry;
              if (e.state === null) entries.delete(`${e.account}/${e.device}`);
              else entries.set(`${e.account}/${e.device}`, e);
            }
            flush();
            setError(null);
          }
        } catch (e) {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e : new Error(String(e)));
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    })();
    return () => ctrl.abort();
  }, [app]);

  return { peers, setPresence, error };
}
