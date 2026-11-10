/**
 * The workspace org's roster: who is in it, with which org role, and the name
 * each person set for the whole workspace (org member metadata). Replaces
 * mero-react's `useGroupMembers` and `@calimero-apps/names` on Calimero 1.0.
 */
import { useCallback, useEffect, useState } from 'react';

import { useSignedIn } from '../sessionContext';
import { publishWorkspaceName, readMembers, type OrgMembers } from '../lib/workspaces';

/** One entry of the org's roster. */
export interface OrgPerson {
  /** The account. */
  identity: string;
  /** `owner`, `admin`, `member` or `guest`. */
  role: string;
}

export interface UseOrgMembers {
  people: OrgPerson[];
  /** The name an account set for the workspace, if it set one. */
  nameOf: (account: string | null | undefined) => string | undefined;
  /** A name to show: the workspace name, else the start of the account. */
  displayName: (account: string | null | undefined) => string;
  /** This account's workspace name ('' when it has none). */
  myName: string;
  /** Publish this account's workspace name. */
  setMyName: (name: string) => Promise<void>;
  /** The org keeps its apps apart and Mero Sheets has its team: Remove and Leave are its only. */
  appOnly: boolean;
  /** True once the roster has been read (or failed to be) at least once. */
  loaded: boolean;
  refetch: () => Promise<void>;
}

const EMPTY: OrgMembers = { roles: new Map(), names: new Map(), people: [], appOnly: false };

export function useOrgMembers(org: string | null): UseOrgMembers {
  const { client, accountId, source, after } = useSignedIn();
  const [members, setMembers] = useState<OrgMembers>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    if (!org) {
      setMembers(EMPTY);
      setLoaded(true);
      return;
    }
    try {
      setMembers(await readMembers(client, org, source));
    } catch {
      // Unreachable for now: keep what we had; the next open re-reads.
    } finally {
      setLoaded(true);
      after();
    }
  }, [client, org, source, after]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const nameOf = useCallback(
    (account: string | null | undefined) => (account ? members.names.get(account) : undefined),
    [members],
  );
  const displayName = useCallback(
    (account: string | null | undefined) =>
      (account && members.names.get(account)) || (account ? `${account.slice(0, 8)}…` : 'Someone'),
    [members],
  );
  const setMyName = useCallback(
    async (name: string) => {
      if (!org) return;
      try {
        await publishWorkspaceName(client, org, accountId, name.trim());
      } finally {
        after();
      }
      await refetch();
    },
    [client, org, accountId, after, refetch],
  );

  return {
    // Who has Mero Sheets in the workspace (its app team, else the org), with their org role.
    people: members.people.map((identity) => ({ identity, role: members.roles.get(identity) ?? 'member' })),
    nameOf,
    displayName,
    myName: members.names.get(accountId) ?? '',
    setMyName,
    appOnly: members.appOnly,
    loaded,
    refetch,
  };
}
