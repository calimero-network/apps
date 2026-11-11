// What to call an account: the name it set in a team (org member metadata
// `{ name }`), else its id shortened. Replaces `@calimero-apps/names`, which
// reads v1 namespace metadata.

import { useCallback, useEffect, useState } from 'react';

import { memberName, readOrg } from './vaults';
import { type ClientRoutes } from '@calimero-apps/connect';

/** `abcdef…7890` for a long id; short ids as they are; `unknown` for none. */
export function shortAccount(
  id: string | null | undefined,
  head = 6,
  tail = 4,
): string {
  const s = id?.trim() ?? '';
  if (!s) return 'unknown';
  return s.length <= head + tail + 1
    ? s
    : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Every name set in `org`, re-read on `refresh`. */
export function useMemberNames(
  client: ClientRoutes<{ orgs: 'get' }> | null,
  org: string | null,
): { nameOf: (account: string) => string | undefined; refresh: () => void } {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!client || !org) {
      setNames(new Map());
      return;
    }
    let live = true;
    readOrg(client, org)
      .then((view) => {
        if (!live) return;
        const next = new Map<string, string>();
        for (const account of Object.keys(view.members)) {
          const name = memberName(view, account);
          if (name) next.set(account, name);
        }
        setNames(next);
      })
      .catch(() => {
        if (live) setNames(new Map());
      });
    return () => {
      live = false;
    };
  }, [client, org, tick]);
  const nameOf = useCallback((account: string) => names.get(account), [names]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { nameOf, refresh };
}

/** Set the name `account` shows in `org`. */
export async function publishMemberName(
  client: ClientRoutes<{ orgs: 'memberMetadata' }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.orgs.memberMetadata({
    org,
    account,
    metadata: { name: name.trim() },
  });
}
