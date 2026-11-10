import { useCallback, useEffect, useMemo, useState } from "react";

import { useSignedIn } from "./sessionContext";
import { readOrg, setMyTeamName, type OrgMembers } from "./teams";

/**
 * What the team (an org) says about its people: their roles and the names they
 * set on it, which every app on the team shares. Replaces v1's
 * `@calimero-apps/names` hooks, which read the namespace's member metadata.
 */
export interface TeamInfo {
  /** The org's name; "" until read. */
  name: string;
  /** The read has answered (or failed). */
  ready: boolean;
  /** account -> role (`owner` | `admin` | `member` | `guest`), the whole org. */
  roles: Map<string, string>;
  /** Who has Mero Pixart in the team: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and Mero Pixart has its team: Remove and invites are its only. */
  appOnly: boolean;
  /** The name a member set on the team, or "". */
  nameOf: (account: string) => string;
  /** Read again (after a change). */
  reload: () => void;
}

const EMPTY: OrgMembers = { name: "", roles: new Map(), names: new Map(), people: [], appOnly: false };

export function useTeam(teamId: string | undefined): TeamInfo {
  const { client, source, after } = useSignedIn();
  const [org, setOrg] = useState<OrgMembers>(EMPTY);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!teamId) {
      setReady(true);
      return;
    }
    let live = true;
    readOrg(client, teamId, source)
      .then((o) => {
        if (live) setOrg(o);
      })
      .catch(() => {
        /* the last answer stays */
      })
      .finally(() => {
        if (live) setReady(true);
        after();
      });
    return () => {
      live = false;
    };
  }, [client, source, teamId, tick, after]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return useMemo(
    () => ({
      name: org.name,
      ready,
      roles: org.roles,
      people: org.people,
      appOnly: org.appOnly,
      nameOf: (account: string) => org.names.get(account) ?? "",
      reload,
    }),
    [org, ready, reload],
  );
}

/** The caller's own name in the team, and a setter (org member metadata). */
export function useMyName(teamId: string | undefined, team: TeamInfo) {
  const { client, accountId, after } = useSignedIn();
  const { nameOf, reload, ready } = team;
  const setName = useCallback(
    async (name: string) => {
      if (!teamId) return;
      try {
        await setMyTeamName(client, teamId, accountId, name);
      } finally {
        after();
        reload();
      }
    },
    [client, teamId, accountId, after, reload],
  );
  return { ready, name: nameOf(accountId), setName };
}
