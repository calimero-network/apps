// ── Which installed application is Mero Sign, on THIS node ───────────────────
//
// Every namespace call needs it: `createNamespace` and
// `listNamespacesForApplication` both take an application id, and it is
// per-install (`hash(package, signer)`), so it cannot be baked into the build.
// See the long note in `lib/appId.ts` for why the `VITE_APPLICATION_ID` this
// replaced could only ever be right on one machine.
//
// A hook rather than a call at each site because the answer is a network round
// trip on first use, and three screens want it at once. `resolveApplicationId`
// caches a positive answer for the page's lifetime, so this settles to a
// constant after the first connected render.

import { useCallback, useEffect, useState } from 'react';

import { APP_PACKAGE, resolveApplicationId } from '../lib/appId';
import { apiClient } from '../lib/node';
import { useCalimero } from '../lib/useCalimero';

export interface ApplicationIdState {
  applicationId: string | null;
  loading: boolean;
  /** Set when the node answered, and this app was not among the answers. */
  notInstalled: boolean;
  error: string | null;
  reload: () => void;
}

export function useApplicationId(): ApplicationIdState {
  const { app } = useCalimero();
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // `app` is the signal that a node connection exists — `apiClient` throws
    // rather than returning an error when it does not, precisely so a missing
    // connection cannot read as a refusal.
    if (!app) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    resolveApplicationId(() => apiClient.node().getInstalledApplications())
      .then((id) => {
        if (cancelled) return;
        setApplicationId(id || null);
        setNotInstalled(!id);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [app, nonce]);

  return { applicationId, loading, notInstalled, error, reload };
}

/** The sentence shown when the node has never installed this app. */
export const NOT_INSTALLED_MESSAGE =
  `${APP_PACKAGE} is not installed on this node, so it has no workspaces. ` +
  'Install it from the registry and reload.';
