import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { displayName } from "./lib/people";
import { publishName, readMembers, type OrgMembers } from "./lib/orgs";
import { useMaybeSignedIn } from "./sessionContext";

/**
 * The organization the open workspace lives in, and what it knows about its
 * members: their roles and the name each set for the org (org member
 * metadata, shared by every app in it). v1 read the same from the namespace
 * through `@calimero-apps/names`.
 */
interface OrgValue {
  org: string | null;
  members: OrgMembers | null;
  reload: () => void;
}

const OrgContext = createContext<OrgValue>({ org: null, members: null, reload: () => {} });
export const OrgProvider = OrgContext.Provider;

/** Provide the org `org` (and its members) to everything below. */
export function TeamNamespace({ org, children }: { org: string | null; children: ReactNode }) {
  const signedIn = useMaybeSignedIn();
  const client = signedIn?.client ?? null;
  const after = signedIn?.after;
  const source = signedIn?.source ?? null;
  const [members, setMembers] = useState<OrgMembers | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!client || !org) return;
    let live = true;
    readMembers(client, org, source)
      .then((m) => live && setMembers(m))
      .catch(() => live && setMembers(null))
      .finally(() => after?.());
    return () => {
      live = false;
    };
  }, [client, org, source, after, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const value = useMemo(() => ({ org, members, reload }), [org, members, reload]);
  return <OrgProvider value={value}>{children}</OrgProvider>;
}

export function useOrg(): OrgValue {
  return useContext(OrgContext);
}

/**
 * Names people set for the whole org, and where a name picked here is
 * published so every other app in the org shows it too.
 */
export function useSpaceNames() {
  const { org, members, reload } = useContext(OrgContext);
  const signedIn = useMaybeSignedIn();
  const client = signedIn?.client ?? null;
  const nameOf = useCallback((account: string) => members?.names.get(account) ?? null, [members]);

  /** Best-effort: a refusal is quiet. */
  const publish = useCallback(
    (account: string | null | undefined, name: string) => {
      if (!client || !org || !account || !name.trim()) return;
      void publishName(client, org, account, name.trim())
        .then(reload)
        .catch(() => undefined);
    },
    [client, org, reload],
  );

  return { nameOf, publish };
}

/** What to call `account`: the name given here, else their org name, else a short id. */
export function PersonName({ account, name }: { account: string; name?: string | null }) {
  const { nameOf } = useSpaceNames();
  return <>{displayName(account, name, nameOf(account))}</>;
}
