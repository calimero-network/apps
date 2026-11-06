// The connection and the signed-in account: merod local's nodes in
// development, the Calimero Cloud cluster in production, through mero-js 28's
// CalimeroClient (@calimero-apps/connect). Replaces v1's MeroProvider: there
// is no node URL to pick and no node login; the account is a passkey.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  browserPasskey,
  type CalimeroClient,
  type PasskeyProvider,
  type SignUpPolicy,
} from '@calimero-network/mero-js';
import {
  SessionStore,
  appSource,
  createClient,
  describeError,
  describeSignInError,
  connectTarget,
  isPasskeyUnknownHere,
  NotServedError,
  readSignUpPolicy,
  signUpAccess,
  signUpInvite,
  type AppSource,
  type ConnectEnv,
  type KeyValueStorage,
  type SignUpAccess,
  type Target,
} from '@calimero-apps/connect';
import { isPasskeyCancel, type ListingProps } from '@calimero-apps/passkey';
import { PACKAGE_NAME } from '@/constants/config';

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

export type Session =
  | { status: 'connecting' }
  | { status: 'unconfigured'; message: string }
  /** A copy of the app no cluster serves (its listing page): shows `<AppListing>`. */
  | { status: 'listing'; message: string }
  | { status: 'signed-out'; client: CalimeroClient; target: Target }
  | { status: 'signed-in'; client: CalimeroClient; target: Target; accountId: string };

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

export interface SessionApi {
  session: Session;
  error: string | null;
  busy: boolean;
  /** Where app instances are created from: the dev bundle, or the package. */
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Keeps the stored session current after a request (refresh tokens are single-use). */
  sync: () => void;
  signIn(): Promise<void>;
  /**
   * Create an account with a new passkey; the name is optional. On a cluster
   * that requires an invite, the pending invite's token goes with it.
   */
  signUp(name?: string): Promise<void>;
  signOut(): Promise<void>;
  /** What the cluster's sign-up policy lets this page do (`unknown` until read). */
  signUpAccess: SignUpAccess;
  /** The last sign-in failed because the cluster has no account for that passkey. */
  passkeyUnknown: boolean;
}

const SessionContext = createContext<SessionApi | null>(null);

function useSessionState(deps: SessionDeps, invite?: () => string | null): SessionApi {
  const [session, setSession] = useState<Session>({ status: 'connecting' });
  const [store, setStore] = useState<SessionStore | null>(null);
  // The failed ceremony, described when shown, so the words follow the
  // sign-up policy even when it is read after the failure.
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  /** The cluster's sign-up policy: `undefined` until read, `null` when it cannot be. */
  const [policy, setPolicy] = useState<SignUpPolicy | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      let target: Target;
      try {
        target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app: APP, package: PACKAGE_NAME });
      } catch (e) {
        if (live) {
          setSession({ status: e instanceof NotServedError ? 'listing' : 'unconfigured', message: describeError(e) });
        }
        return;
      }
      try {
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(APP, target, deps.storage);
        if (!live) return;
        setStore(sessions);
        if (sessions.restore(client) && client.session) {
          setSession({ status: 'signed-in', client, target, accountId: client.session.accountId });
        } else {
          setSession({ status: 'signed-out', client, target });
        }
      } catch (e) {
        if (live) setSession({ status: 'unconfigured', message: describeError(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [deps]);

  const signedOutClient = session.status === 'signed-out' ? session.client : null;
  useEffect(() => {
    if (!signedOutClient) return;
    let live = true;
    void readSignUpPolicy(signedOutClient).then((p) => {
      if (live) setPolicy(p);
    });
    return () => {
      live = false;
    };
  }, [signedOutClient]);

  const inviteToken = invite?.() ?? null;
  const access = signUpAccess(policy, inviteToken !== null);
  const invited = signUpInvite(policy, inviteToken);

  const ceremony = useCallback(
    async (run: (client: CalimeroClient) => Promise<{ accountId: string }>) => {
      if (session.status !== 'signed-out') return;
      setBusy(true);
      setFailure(null);
      try {
        const { accountId } = await run(session.client);
        store?.sync(session.client);
        setSession({ status: 'signed-in', client: session.client, target: session.target, accountId });
      } catch (e) {
        // A dismissed passkey prompt is a quiet cancel, not an error to show.
        if (!isPasskeyCancel(e)) setFailure({ error: e });
      } finally {
        setBusy(false);
      }
    },
    [session, store],
  );

  const signIn = useCallback(() => ceremony((c) => c.signIn(deps.passkey())), [ceremony, deps]);
  const signUp = useCallback(
    (name?: string) =>
      ceremony((c) =>
        invited
          ? c.signUp(deps.passkey(), name?.trim() ?? '', { invite: invited })
          : c.signUp(deps.passkey(), name?.trim() ?? ''),
      ),
    [ceremony, deps, invited],
  );

  const signOut = useCallback(async () => {
    if (session.status !== 'signed-in') return;
    try {
      await session.client.signOut();
    } catch {
      // Already expired or unreachable: forgetting it here is what matters.
    }
    store?.clear();
    setSession({ status: 'signed-out', client: session.client, target: session.target });
  }, [session, store]);

  const client = session.status === 'signed-in' ? session.client : null;
  const sync = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);

  const source = useMemo(() => appSource(deps.env, PACKAGE_NAME), [deps.env]);

  const error = failure ? describeSignInError(failure.error, access) : null;
  const passkeyUnknown = failure !== null && isPasskeyUnknownHere(failure.error);

  return useMemo(
    () => ({
      session,
      error,
      busy,
      source,
      passkey: deps.passkey,
      sync,
      signIn,
      signUp,
      signOut,
      signUpAccess: access,
      passkeyUnknown,
    }),
    [session, error, busy, source, deps.passkey, sync, signIn, signUp, signOut, access, passkeyUnknown],
  );
}

/** Connects once and shares the session with every screen. */
export function SessionProvider({
  deps = defaultDeps,
  invite,
  children,
}: {
  deps?: SessionDeps;
  /** The pending invite's token: on an invite-only cluster it lets a new person sign up. */
  invite?: () => string | null;
  children: ReactNode;
}) {
  const api = useSessionState(deps, invite);
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
