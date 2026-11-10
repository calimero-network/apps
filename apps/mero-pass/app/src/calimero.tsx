// The connection to Calimero, for every screen: the local `merod local` nodes
// under `vite` (dev), a Calimero Cloud cluster by name (or an attested node by
// URL, `VITE_CALIMERO_TARGET=node`) in a production build,
// through `@calimero-apps/connect` and mero-js's `CalimeroClient`. It replaces
// mero-react's `MeroProvider`: sign-in is a passkey (sign in, or a new account
// with a new passkey), a session is stored per app and per target, and there is
// no node URL to type, no auth frontend and no desktop hand-off.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
  browserPasskey,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import {
  appSource,
  createClient,
  type AppSource,
  type ConnectEnv,
  type KeyValueStorage,
  type SignUpAccess,
  type Target,
} from '@calimero-apps/connect';
import {
  usePasskeySession,
  type ListingProps,
  type SignUpStage,
} from '@calimero-apps/passkey';

import { invites, noteJoinedAtSignUp } from './lib/inviteLink';
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
  /** The last sign-in found no account here: creating one is the way on. */
  noAccountHere?: boolean;
  /** This browser has signed in to an account on this cluster before. */
  knownAccount?: boolean;
  /** Whether the page holds an invite token. */
  hasInvite?: boolean;
  /**
   * Where a sign-up is, `null` outside one. Its second prompt is asked right
   * after the first (`confirm`). At `approve` the new passkey exists and the
   * account waits for `approve()`: that prompt failed or was refused
   * (Safari's user-gesture rule, a blocked prompt, a closed prompt), so it
   * starts from a click of its own.
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

const Ctx = createContext<Calimero | null>(null);

/**
 * The shared passkey session (`@calimero-apps/passkey`): only this cluster's
 * passkeys, "no account here" as create-in-place, Sign in first for an invited
 * person with an account, and the invite carried at sign-up, where it joins
 * the team in that step. This adds what the screens read beside it.
 */
export function CalimeroProvider({
  children,
  deps = defaultDeps,
}: {
  children: ReactNode;
  deps?: CalimeroDeps;
}) {
  const api = usePasskeySession(APP, deps, {
    package: PACKAGE,
    // The pending invite: the hook binds it to the cluster, and drops it on
    // sign-out, on a refusal and once a sign-up joined with it.
    invites,
    // Joined at sign-up: nothing is left to redeem (a second redeem would
    // spend another use of the link); the invitation prompt opens the team.
    onJoinedAtSignUp: noteJoinedAtSignUp,
  });
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const client =
    session.status === 'signed-in' || session.status === 'signed-out'
      ? session.client
      : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  const value = useMemo<Calimero>(() => {
    const target =
      session.status === 'signed-in' || session.status === 'signed-out'
        ? session.target
        : null;
    return {
      status: session.status,
      client,
      target,
      accountId: session.status === 'signed-in' ? session.accountId : null,
      source,
      message:
        session.status === 'unconfigured' || session.status === 'listing'
          ? session.message
          : null,
      error: api.error,
      busy: api.busy,
      isAuthenticated: session.status === 'signed-in',
      isLoading: session.status === 'connecting',
      where: describeTarget(target),
      signIn: api.signIn,
      signUp: api.signUp,
      signOut: api.signOut,
      signUpAccess: api.signUpAccess,
      passkeyUnknown: api.passkeyUnknown,
      noAccountHere: api.noAccountHere,
      knownAccount: api.knownAccount,
      hasInvite: api.hasInvite,
      stage: api.stage,
      approve: api.approve,
      cancelSignUp: api.cancelSignUp,
      passkey: deps.passkey,
      after,
    };
  }, [api, session, client, source, deps.passkey, after]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCalimero(): Calimero {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCalimero outside <CalimeroProvider>');
  return value;
}

/** For tests and screens that render without the provider. */
export const CalimeroContext = Ctx;
