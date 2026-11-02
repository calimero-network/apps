import { useCallback, useEffect, useState } from "react";

import { useSignedIn } from "../sessionContext";
import { publishTeamName, readMembers } from "./teams";

/**
 * The name each person goes by across a team: org member metadata `{ name }`,
 * shared by every project (and every app) in the org. Replaces v1's
 * `@calimero-apps/names` (namespace member metadata through the admin client).
 */

/** Everyone's team name, by account. */
export function useMemberNames(org: string | undefined): { nameOf: (account: string) => string | undefined; reload: () => void } {
  const { client, after } = useSignedIn();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!org) return;
    let live = true;
    readMembers(client, org)
      .then((m) => live && setNames(m.names))
      .catch(() => {})
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, org, after, tick]);
  const nameOf = useCallback((account: string) => names.get(account), [names]);
  return { nameOf, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** The caller's own team name: `ready` once the team has answered. */
export function useMyName(org: string | undefined): { name: string; ready: boolean; setName: (name: string) => Promise<void> } {
  const { client, accountId, after } = useSignedIn();
  const [name, setLocal] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!org) return;
    let live = true;
    setReady(false);
    readMembers(client, org)
      .then((m) => {
        if (!live) return;
        setLocal(m.names.get(accountId) ?? "");
        setReady(true);
      })
      .catch(() => live && setReady(true))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, org, accountId, after]);
  const setName = useCallback(
    async (next: string) => {
      if (!org) return;
      try {
        await publishTeamName(client, org, accountId, next);
        setLocal(next);
      } finally {
        after();
      }
    },
    [client, org, accountId, after],
  );
  return { name, ready, setName };
}
