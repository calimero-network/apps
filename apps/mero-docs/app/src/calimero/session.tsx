// The connection and the signed-in account: merod local's nodes in
// development, the Calimero Cloud cluster in production, through mero-js 28's
// CalimeroClient (@calimero-apps/connect). Replaces v1's MeroProvider: there
// is no node URL to pick and no node login; the account is a passkey.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { browserPasskey, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import {
  appSource,
  createClient,
  type AppSource,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from '@calimero-apps/connect';
import {
  usePasskeySession,
  type ListingProps,
  type SessionApi as PasskeySessionApi,
} from '@calimero-apps/passkey';
import { PACKAGE_NAME } from '@/constants/config';
import { invites, noteJoinedAtSignUp } from '@/hooks/useNamespaceInvitation';

/** The app's name in stored keys. */
export const APP = 'mero-docs';

/** What the listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: 'Mero Docs',
  description: 'A document workspace organized by folders: rich-text documents your organization edits together.',
  package: PACKAGE_NAME,
  dir: 'mero-docs',
  dev: import.meta.env.DEV,
};

export type { Session } from '@calimero-apps/passkey';

/** What the session is built from: the real ones in the app, fakes in tests. */
export interface SessionDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  /** The cluster's node list when this page is served by it (production). */
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: SessionDeps = {
  env: import.meta.env as unknown as ConnectEnv,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`: this cluster's
 * passkeys only, "no account here" as create-in-place, the invite carried at
 * sign-up), plus what this app's screens read from it.
 */
export interface SessionApi extends PasskeySessionApi {
  /** Where app instances are created from: the dev bundle, or the package. */
  source: AppSource;
  /** Keeps the stored session current after a request (refresh tokens are single-use). */
  sync: () => void;
}

const SessionContext = createContext<SessionApi | null>(null);

function useSessionState(deps: SessionDeps): SessionApi {
  const api = usePasskeySession(APP, deps, {
    package: PACKAGE_NAME,
    // The pending invite: the hook binds it to the cluster, and drops it on
    // sign-out, on a refusal and once a sign-up joined with it.
    invites,
    // A sign-up from a page holding the invite joined its organization in that
    // step: nothing is left to redeem (a second redeem would spend another
    // use). InvitationPrompt opens the workspace or folder it named.
    onJoinedAtSignUp: noteJoinedAtSignUp,
  });
  const { session, store } = api;
  const client = session.status === 'signed-in' ? session.client : null;
  const sync = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);
  const source = useMemo(() => appSource(deps.env, PACKAGE_NAME), [deps.env]);
  return useMemo(() => ({ ...api, source, sync }), [api, source, sync]);
}

/** Connects once and shares the session with every screen. */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSessionState(deps);
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside <SessionProvider>');
  return value;
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === 'local'
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? '' : 's'})`
    : `Calimero Cloud ${target.cluster}`;
}
