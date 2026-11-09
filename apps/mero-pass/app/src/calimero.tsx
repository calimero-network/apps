// The connection to Calimero, for every screen: the local `merod local` nodes
// under `vite` (dev), a Calimero Cloud cluster by name (or an attested node by
// URL, `VITE_CALIMERO_TARGET=node`) in a production build,
// through `@calimero-apps/connect` and mero-js's `CalimeroClient`. It replaces
// mero-react's `MeroProvider`: sign-in is a passkey (sign in, or a new account
// with a new passkey), a session is stored per app and per target, and there is
// no node URL to type, no auth frontend and no desktop hand-off.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  NotServedError,
  connectTarget,
  isPasskeyUnknownHere,
  readSignUpPolicy,
  signUpAccess,
  signUpInvite,
  type AppSource,
  type ConnectEnv,
  type KeyValueStorage,
  type SignUpAccess,
  type Target,
} from '@calimero-apps/connect';
import {
  describeSignUpNotFinished,
  isPasskeyCancel,
  signUpFlow,
  type ListingProps,
  type SignUpFlow,
  type SignUpStage,
} from '@calimero-apps/passkey';

import { pendingInvite } from './lib/inviteLink';
import { PACKAGE } from './lib/meroPass';

/** The app's name in stored keys. */
export const APP = 'mero-pass';

/** What the listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: 'Mero Pass',
  description:
    'A secret manager for teams: vaults end-to-end encrypted in the browser.',
  package: PACKAGE,
  dir: 'mero-pass',
  dev: import.meta.env.DEV,
};

/** `listing`: a copy of the app no cluster serves (its listing page). */
export type Status =
  'connecting' | 'unconfigured' | 'listing' | 'signed-out' | 'signed-in';

export interface Calimero {
  status: Status;
  /** Set once connected (signed in or out). */
  client: CalimeroClient | null;
  target: Target | null;
  /** The signed-in account. */
  accountId: string | null;
  /** Where vaults are created from: the dev bundle, or the package. */
  source: AppSource;
  /** Why the app cannot connect (`unconfigured`, `listing`). */
  message: string | null;
  /** The last sign-in failure. */
  error: string | null;
  busy: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** "merod local (3 nodes)" / "Calimero Cloud <cluster>" / "node <host>". */
  where: string;
  signIn(): Promise<void>;
  /**
   * Create an account with a new passkey; the name is optional. On a cluster
   * that requires an invite, the invite link's token goes with it.
   */
  signUp(name?: string): Promise<void>;
  signOut(): Promise<void>;
  /** What the cluster's sign-up policy lets this page do (`unknown` until read). */
  signUpAccess?: SignUpAccess;
  /** The last sign-in failed because the cluster has no account for that passkey. */
  passkeyUnknown?: boolean;
  /**
   * Where a sign-up is, `null` outside one. Its second prompt is asked right
   * after the first (`confirm`). At `approve` the new passkey exists and the
   * account waits for `approve()`: the browser refused that prompt at once
   * (Safari's user-gesture rule, a blocked prompt), so it starts from a click
   * of its own.
   */
  stage?: SignUpStage | null;
  /** The click that creates the account with the new passkey (at `stage: "approve"`). */
  approve?(): void;
  /** Give up the sign-up at its Approve step. Quiet: no error is shown. */
  cancelSignUp?(): void;
  /** A passkey for a step-up (`412 CONFIRM_REQUIRED`): invites, member changes. */
  passkey(): PasskeyProvider;
  /** Keeps the stored session current; run after requests. */
  after(): void;
}

/** What the provider is built from: the real ones in the app, fakes in tests. */
export interface CalimeroDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: CalimeroDeps = {
  env: import.meta.env,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

export function describeTarget(target: Target | null): string {
  if (!target) return '';
  return target.kind === 'local'
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? '' : 's'})`
    : target.direct
      ? `node ${target.cluster}`
      : `Calimero Cloud ${target.cluster}`;
}

type State =
  | { status: 'connecting' }
  | { status: 'unconfigured' | 'listing'; message: string }
  | { status: 'signed-out'; client: CalimeroClient; target: Target }
  | {
      status: 'signed-in';
      client: CalimeroClient;
      target: Target;
      accountId: string;
    };

const Ctx = createContext<Calimero | null>(null);

export function CalimeroProvider({
  children,
  deps = defaultDeps,
}: {
  children: ReactNode;
  deps?: CalimeroDeps;
}) {
  const [state, setState] = useState<State>({ status: 'connecting' });
  const [store, setStore] = useState<SessionStore | null>(null);
  // The failed ceremony, described when shown, so the words follow the
  // sign-up policy even when it is read after the failure. `afterCreate`: the
  // sign-up's passkey was made, so even a cancel-like failure is shown.
  const [failure, setFailure] = useState<{
    error: unknown;
    afterCreate?: boolean;
  } | null>(null);
  /** The sign-up in flight, if any, and what the control shows of it. */
  const flowRef = useRef<SignUpFlow | null>(null);
  const [flowView, setFlowView] = useState<{
    stage: SignUpStage | null;
    confirmFailure: { error: unknown } | null;
  }>({ stage: null, confirmFailure: null });
  /** The cluster's sign-up policy: `undefined` until read, `null` when it cannot be. */
  const [policy, setPolicy] = useState<SignUpPolicy | null | undefined>(
    undefined,
  );
  /** The `/auth/logout` still in flight, which the next ceremony waits for. */
  const loggingOut = useRef<Promise<void> | null>(null);
  const [busy, setBusy] = useState(false);
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const target = await connectTarget(deps.env, {
          servedNodes: deps.servedNodes,
          app: APP,
          package: PACKAGE,
        });
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(APP, target, deps.storage);
        if (!live) return;
        setStore(sessions);
        if (sessions.restore(client) && client.session) {
          setState({
            status: 'signed-in',
            client,
            target,
            accountId: client.session.accountId,
          });
        } else {
          setState({ status: 'signed-out', client, target });
        }
      } catch (e) {
        if (live)
          setState({
            status: e instanceof NotServedError ? 'listing' : 'unconfigured',
            message: describeError(e),
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [deps]);

  const signedOutClient = state.status === 'signed-out' ? state.client : null;
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

  const inviteToken = pendingInvite(deps.storage);
  const access = signUpAccess(policy, inviteToken !== null);
  const invited = signUpInvite(policy, inviteToken);

  // Leaving the page mid sign-up ends it, so nothing waits on a click.
  useEffect(() => () => flowRef.current?.cancel(), []);

  const ceremony = useCallback(
    async (
      run: (c: CalimeroClient) => Promise<{ accountId: string }>,
      flow?: SignUpFlow,
    ) => {
      if (state.status !== 'signed-out') return;
      setBusy(true);
      setFailure(null);
      if (flow) flowRef.current = flow;
      try {
        // mero-js forgets the session when `/auth/logout` returns, so a sign-in
        // that finished first would be wiped by the sign-out before it.
        await loggingOut.current;
        const { accountId } = await run(state.client);
        store?.sync(state.client);
        setState({
          status: 'signed-in',
          client: state.client,
          target: state.target,
          accountId,
        });
      } catch (e) {
        // A dismissed first prompt (or a cancel at Approve) is quiet. Once the
        // passkey exists, a refused second prompt is not: it left no account.
        const afterCreate = flow?.created === true && !flow.cancelled;
        if (!isPasskeyCancel(e)) setFailure({ error: e });
        else if (afterCreate) setFailure({ error: e, afterCreate: true });
      } finally {
        if (flow && flowRef.current === flow) flowRef.current = null;
        if (flow) setFlowView({ stage: null, confirmFailure: null });
        setBusy(false);
      }
    },
    [state, store],
  );

  const signIn = useCallback(
    () => ceremony((c) => c.signIn(deps.passkey())),
    [ceremony, deps],
  );
  const signUp = useCallback(
    (name?: string) => {
      // The second prompt (core's 412 CONFIRM_REQUIRED) right away; its own
      // click only when the browser refuses it at once (signUpFlow).
      const flow: SignUpFlow = signUpFlow(deps.passkey(), () =>
        setFlowView({ stage: flow.stage, confirmFailure: flow.confirmFailure }),
      );
      return ceremony(
        (c) =>
          invited
            ? c.signUp(flow.passkey, name?.trim() ?? '', { invite: invited })
            : c.signUp(flow.passkey, name?.trim() ?? ''),
        flow,
      );
    },
    [ceremony, deps, invited],
  );
  const approve = useCallback(() => flowRef.current?.approve(), []);
  const cancelSignUp = useCallback(() => flowRef.current?.cancel(), []);
  // Signed out first, then `/auth/logout`: the other way round, screens kept
  // seeing "signed-in" while the node had already revoked the session, and
  // their `/auth/me` calls got 401s (as in @calimero-apps/passkey).
  const signOut = useCallback(async () => {
    if (state.status !== 'signed-in') return;
    const { client, target } = state;
    store?.clear();
    setState({ status: 'signed-out', client, target });
    const logout = client.signOut().catch(() => {
      // Already expired or unreachable: forgetting it here is what matters.
    });
    loggingOut.current = logout;
    try {
      await logout;
    } finally {
      if (loggingOut.current === logout) loggingOut.current = null;
    }
  }, [state, store]);

  const client =
    state.status === 'signed-in' || state.status === 'signed-out'
      ? state.client
      : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  const error = flowView.confirmFailure
    ? describeSignUpNotFinished(flowView.confirmFailure.error)
    : failure
      ? failure.afterCreate
        ? describeSignUpNotFinished(failure.error, true)
        : describeSignInError(failure.error, access)
      : null;
  const passkeyUnknown =
    failure !== null && isPasskeyUnknownHere(failure.error);

  const value = useMemo<Calimero>(() => {
    const target =
      state.status === 'signed-in' || state.status === 'signed-out'
        ? state.target
        : null;
    return {
      status: state.status,
      client,
      target,
      accountId: state.status === 'signed-in' ? state.accountId : null,
      source,
      message:
        state.status === 'unconfigured' || state.status === 'listing'
          ? state.message
          : null,
      error,
      busy,
      isAuthenticated: state.status === 'signed-in',
      isLoading: state.status === 'connecting',
      where: describeTarget(target),
      signIn,
      signUp,
      signOut,
      signUpAccess: access,
      passkeyUnknown,
      stage: flowView.stage,
      approve,
      cancelSignUp,
      passkey: deps.passkey,
      after,
    };
  }, [
    access,
    passkeyUnknown,
    flowView.stage,
    approve,
    cancelSignUp,
    state,
    client,
    source,
    error,
    busy,
    signIn,
    signUp,
    signOut,
    deps,
    after,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCalimero(): Calimero {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCalimero outside <CalimeroProvider>');
  return value;
}

/** For tests and screens that render without the provider. */
export const CalimeroContext = Ctx;
