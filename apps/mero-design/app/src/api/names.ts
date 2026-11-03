import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { peekApi } from "./client";
import { readTeam, setTeamName } from "./rpc";

/**
 * What to call people and teams: the name each person set once for the whole
 * team (org member metadata `{ name }`), and the team's own name. Takes the
 * place of v1's `@calimero-apps/names`, which read namespace metadata through
 * a node's admin API.
 *
 * One directory per page, so every view of a team shares one read, refreshed
 * at most every 30 s.
 */

const TTL_MS = 30_000;

interface Entry {
  names: Map<string, string>;
  teamName: string;
  fetchedAt: number;
  /** A read has finished, successfully or not: the absence of a name now means something. */
  settled: boolean;
  inflight: Promise<void> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const fn of listeners) fn();
}

function entry(team: string): Entry {
  let e = entries.get(team);
  if (!e) {
    e = { names: new Map(), teamName: "", fetchedAt: 0, settled: false, inflight: null };
    entries.set(team, e);
  }
  return e;
}

/** Reads the team now unless a fresh read is already there or under way. */
function load(team: string, force = false): void {
  const e = entry(team);
  if (e.inflight || !peekApi()) return;
  if (!force && e.settled && Date.now() - e.fetchedAt < TTL_MS) return;
  e.inflight = readTeam(team)
    .then((record) => {
      e.names = record.names;
      e.teamName = record.name;
      e.fetchedAt = Date.now();
    })
    .catch(() => {
      e.fetchedAt = Date.now();
    })
    .finally(() => {
      e.inflight = null;
      e.settled = true;
      changed();
    });
}

function useDirectory(team: string | null | undefined): Entry | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => version,
  );
  useEffect(() => {
    if (!team) return;
    load(team);
    const id = setInterval(() => load(team), TTL_MS);
    return () => clearInterval(id);
  }, [team]);
  return team ? entry(team) : null;
}

export interface MemberNames {
  /** The team name for `account`, or `undefined` when it has none. */
  nameOf: (account: string | null | undefined) => string | undefined;
  /** Read again now, e.g. after someone else renamed themselves. */
  refresh: () => void;
}

export function useMemberNames(team: string | null | undefined): MemberNames {
  const e = useDirectory(team);
  const names = e?.names;
  const nameOf = useCallback(
    (account: string | null | undefined) => (account ? names?.get(account) : undefined),
    // `version` moves on every read; the map is replaced, so this is enough.
    [names],
  );
  const refresh = useCallback(() => {
    if (team) load(team, true);
  }, [team]);
  return { nameOf, refresh };
}

export interface MyName {
  /** The team has answered, so `name === ""` really means "no name yet". */
  ready: boolean;
  name: string;
  /** Publishes `name` for the whole team. Rejects when the node refuses. */
  setName: (name: string) => Promise<void>;
}

export function useMyName(team: string | null | undefined, account: string | null | undefined): MyName {
  const e = useDirectory(team);
  const [pending, setPending] = useState<string | null>(null);
  const stored = account ? e?.names.get(account) ?? "" : "";
  const setName = useCallback(
    async (name: string) => {
      if (!team || !account) throw new Error("Open a team first.");
      const trimmed = name.trim();
      await setTeamName(team, account, trimmed);
      entry(team).names = new Map(entry(team).names).set(account, trimmed);
      setPending(trimmed);
      changed();
    },
    [team, account],
  );
  return { ready: !!e?.settled, name: pending ?? stored, setName };
}

/** The team's own name, once read; "" until then. */
export function useTeamRecordName(team: string | null | undefined): string {
  const e = useDirectory(team);
  return e?.teamName ?? "";
}

/** A name for something that has none yet: `Team fb884a`. */
export function placeholderName(kind: string, id: string): string {
  return `${kind} ${id.slice(0, 6)}`;
}
