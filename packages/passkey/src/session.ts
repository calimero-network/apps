import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  browserPasskey,
  type CalimeroClient,
  type PasskeyProvider,
  type SignUpPolicy,
} from "@calimero-network/mero-js";
import {
  SessionStore,
  createClient,
  NotServedError,
  connectTarget,
  describeError,
  readSignUpPolicy,
  signUpAccess,
  type ConnectEnv,
  type SignUpAccess,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";
import { isPasskeyCancel, type SignUpFlow, type SignUpStage } from "./signUpFlow";
import {
  describeCeremonyFailure,
  knownAccountHere,
  noAccountHereAfter,
  passkeyHere,
  passkeyUnknownAfter,
  signInHere,
  signUpFlowHere,
  signUpHere,
  type CeremonyFailure,
  type JoinedAtSignUp,
} from "./ceremony";

export { accountHintKey, knownPasskeysKey, type JoinedAtSignUp } from "./ceremony";

export type Session =
  | { status: "connecting" }
  | { status: "unconfigured"; message: string }
  /**
   * A copy of the app no cluster serves (its listing page, e.g. a static host
   * built without `VITE_CALIMERO_CLUSTER`): the app shows `<AppListing>`,
   * which opens the copy Calimero Cloud serves. `package` is the one the app
   * passed; `message` says why there is nothing to connect to.
   */
  | { status: "listing"; console: string; message: string; package?: string }
  | { status: "signed-out"; client: CalimeroClient; target: Target }
  | { status: "signed-in"; client: CalimeroClient; target: Target; accountId: string };

/** What the hook is built from: the real ones in the app, fakes in tests. */
export interface SessionDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  /** The cluster's node list when this page is served by it (production). */
  servedNodes?: () => Promise<string[] | null>;
}

/**
 * The real deps for a build's environment. Call it once at module level
 * (`passkeyDeps(import.meta.env)`): the hook reconnects when its deps change.
 */
export function passkeyDeps(env: ConnectEnv): SessionDeps {
  return { env, makeClient: (target) => createClient(target), passkey: browserPasskey };
}


export interface SessionApi {
  session: Session;
  /** The sessions kept for this app on this target. */
  store: SessionStore | null;
  error: string | null;
  busy: boolean;
  /** The environment the target was resolved from: where instances come from (`appSource`). */
  env: ConnectEnv;
  /** The passkey every ceremony and step-up uses. */
  passkey: () => PasskeyProvider;
  /** Sign in with a passkey the person already has on this cluster (made in the console or any app on it). */
  signIn(): Promise<void>;
  /**
   * Create an account with a new passkey. The name is optional. On a cluster
   * that requires an invite, the page's invite token goes with it.
   */
  signUp(name?: string): Promise<void>;
  /**
   * Whether this page may create an account on the cluster, from its sign-up
   * policy (read once the client connects) and the page's invite token:
   * `unknown` until read, or when the node cannot say. Optional, so a session
   * an app or a test builds itself still fits; missing reads as `unknown`.
   */
  signUpAccess?: SignUpAccess;
  /** The last sign-in failed because the cluster has no account for that passkey. */
  passkeyUnknown?: boolean;
  /**
   * The last sign-in found no account here: the cluster did not know the
   * passkey, or the browser prompt closed without one chosen (a browser with
   * no passkey for this cluster shows nothing to pick, and the person can
   * only close it). Creating an account is the way on.
   */
  noAccountHere?: boolean;
  /** Where a sign-up is ({@link SignUpStage}), `null` when none runs. */
  stage?: SignUpStage | null;
  /** Starts a sign-up's second prompt, once it is at `approve` (the browser refused to show it right away). */
  approve?(): void;
  /** Gives up a sign-up waiting at `approve`: no account is made. Quiet. */
  cancelSignUp?(): void;
  /** Whether the page holds an invite token. */
  hasInvite?: boolean;
  /** This browser has signed in to an account on this cluster before (a hint kept in storage). */
  knownAccount?: boolean;
  /** The invite token a sign-up from this page spent to join, once it has. */
  joinedInvite?: string | null;
  signOut(): Promise<void>;
}

export { isPasskeyCancel };

/** What the app says about itself, beside its name. */
export interface PasskeySessionOptions {
  /**
   * The app's package id: where a production build that names no cluster, on
   * a page no cluster serves, asks the directory where the app runs
   * (`connectTarget`).
   */
  package?: string;
  /**
   * The invite token this page holds (captured from `?invite=`), if any. On a
   * cluster whose sign-up policy is `invite` it is what lets a new person
   * create an account, and it goes with the sign-up there.
   *
   * With `onJoinedAtSignUp`, the token goes with every sign-up the policy
   * lets it (an `open` cluster too): the new account joins the invite's
   * organization in that one step, as "Create your account and join" says.
   */
  invite?: () => string | null;
  /**
   * Called once a sign-up made with the page's invite has joined its
   * organization, before the session is signed in: the app drops its pending
   * invite (there is nothing left to redeem; redeeming again would spend
   * another use) and may open what the invite was for. Without it, the token
   * goes with a sign-up only where the cluster requires one, and the app
   * redeems it after.
   */
  onJoinedAtSignUp?: (joined: JoinedAtSignUp) => void;
  /**
   * Whether a sign-up goes through {@link signUpFlow}: its second prompt is
   * asked right away, and waits at `approve` for a click when that ask
   * failed or was refused. On by default; a caller with no button to
   * show turns it off.
   */
  approveWithClick?: boolean;
}

/**
 * Connects to the local nodes (dev) or the Cloud cluster (production: named by
 * the build, else the one serving the page, else the package's primary cluster
 * in the directory), restores a stored session for `app`, and signs in or up
 * with a passkey.
 */
export function usePasskeySession(app: string, deps: SessionDeps, options: PasskeySessionOptions = {}): SessionApi {
  const { package: pkg, invite, onJoinedAtSignUp, approveWithClick = true } = options;
  const [session, setSession] = useState<Session>({ status: "connecting" });
  const [store, setStore] = useState<SessionStore | null>(null);
  // The failed ceremony's error, described at render time so the words follow
  // the sign-up policy even when it is read after the failure.
  const [failure, setFailure] = useState<CeremonyFailure | null>(null);
  const [busy, setBusy] = useState(false);
  /** The sign-up in flight, if any, and what the control shows of it ({@link signUpFlow}). */
  const flowRef = useRef<SignUpFlow | null>(null);
  const [flowView, setFlowView] = useState<{ stage: SignUpStage | null; confirmFailure: { error: unknown } | null }>({
    stage: null,
    confirmFailure: null,
  });
  const [knownAccount, setKnownAccount] = useState(false);
  const [joinedInvite, setJoinedInvite] = useState<string | null>(null);
  const joined = useRef(onJoinedAtSignUp);
  joined.current = onJoinedAtSignUp;
  const hintStorage = deps.storage ?? (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  /** The cluster's sign-up policy: `undefined` until read, `null` when it cannot be. */
  const [policy, setPolicy] = useState<SignUpPolicy | null | undefined>(undefined);
  /** The `/auth/logout` still in flight, which the next ceremony waits for. */
  const loggingOut = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let target: Target;
      try {
        target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app, package: pkg });
      } catch (e) {
        if (!live) return;
        setSession(
          e instanceof NotServedError
            ? { status: "listing", console: e.console, message: describeError(e), ...(pkg ? { package: pkg } : {}) }
            : { status: "unconfigured", message: describeError(e) },
        );
        return;
      }
      try {
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(app, target, deps.storage);
        if (!live) return;
        setStore(sessions);
        setKnownAccount(knownAccountHere(target, hintStorage));
        if (sessions.restore(client) && client.session) {
          setSession({ status: "signed-in", client, target, accountId: client.session.accountId });
        } else {
          setSession({ status: "signed-out", client, target });
        }
      } catch (e) {
        if (live) setSession({ status: "unconfigured", message: describeError(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [app, deps, pkg, hintStorage]);

  // Read once per client, while signed out, so the sign-up control is right
  // before anyone presses it.
  const signedOutClient = session.status === "signed-out" ? session.client : null;
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

  const ceremony = useCallback(
    async (
      during: CeremonyFailure["during"],
      run: (client: CalimeroClient, target: Target) => Promise<{ accountId: string }>,
      flow?: SignUpFlow,
    ) => {
      if (session.status !== "signed-out") return;
      setBusy(true);
      setFailure(null);
      if (flow) flowRef.current = flow;
      try {
        // mero-js forgets the session when `/auth/logout` returns, so a sign-in
        // that finished first would be wiped by the sign-out before it.
        await loggingOut.current;
        const { accountId } = await run(session.client, session.target);
        store?.sync(session.client);
        setKnownAccount(true);
        setSession({ status: "signed-in", client: session.client, target: session.target, accountId });
      } catch (e) {
        // Once a sign-up's passkey exists it never ends here on its own: it
        // waits at Approve (signUpFlow). What does end here is a cancel, or a
        // failure before or after the prompts.
        setFailure({ error: e, during });
      } finally {
        if (flow && flowRef.current === flow) flowRef.current = null;
        if (flow) setFlowView({ stage: null, confirmFailure: null });
        setBusy(false);
      }
    },
    [session, store],
  );

  // Every ceremony offers this cluster's passkeys only ({@link signInHere}).
  const signIn = useCallback(
    () => ceremony("sign-in", (c, target) => signInHere(c, target, deps.passkey(), hintStorage)),
    [ceremony, deps, hintStorage],
  );
  // With `onJoinedAtSignUp` the app hands the invite's join to the sign-up;
  // without it, only a cluster that requires an invite gets one.
  const join = onJoinedAtSignUp !== undefined;
  const signedOutTarget = session.status === "signed-out" ? session.target : null;
  const signUp = useCallback(
    (name?: string) => {
      // The second prompt right away, falling back to its own click when the
      // browser refuses it ({@link signUpFlow}); a caller with no button to
      // show turns that off.
      const flow: SignUpFlow | undefined =
        approveWithClick && signedOutTarget
          ? signUpFlowHere(deps.passkey(), signedOutTarget, hintStorage, () =>
              setFlowView({ stage: flow!.stage, confirmFailure: flow!.confirmFailure }),
            )
          : undefined;
      return ceremony(
        "sign-up",
        async (c, target) => {
          const passkey = flow ? flow.passkey : passkeyHere(deps.passkey(), target, hintStorage);
          const made = await signUpHere(c, target, passkey, {
            name,
            invite: inviteToken,
            policy,
            join,
            storage: hintStorage,
          });
          if (made.joined && joined.current) {
            setJoinedInvite(made.joined.invite);
            joined.current(made.joined);
          }
          return made;
        },
        flow,
      );
    },
    [ceremony, deps, signedOutTarget, hintStorage, inviteToken, policy, join, approveWithClick],
  );

  const approve = useCallback(() => flowRef.current?.approve(), []);
  const cancelSignUp = useCallback(() => flowRef.current?.cancel(), []);
  // Leaving the page mid sign-up ends it, so nothing waits on a click.
  useEffect(() => () => flowRef.current?.cancel(), []);

  // Signed out first, then `/auth/logout`. The other way round, the app kept
  // seeing "signed-in" while the node had already revoked the session, so the
  // screens a sign-out navigates to called `/apps` and `/auth/me` with it and
  // got 401s.
  const signOut = useCallback(async () => {
    if (session.status !== "signed-in") return;
    const { client, target } = session;
    store?.clear();
    setFailure(null);
    setSession({ status: "signed-out", client, target });
    const logout = client.signOut().catch(() => {
      // Already expired or unreachable: forgetting it here is what matters.
    });
    loggingOut.current = logout;
    try {
      await logout;
    } finally {
      if (loggingOut.current === logout) loggingOut.current = null;
    }
  }, [session, store]);

  // A dismissed prompt is a quiet cancel, except a sign-up's approval: the
  // passkey is made by then, the account is not, and the person has to know.
  // A refused approval keeps the sign-up waiting at Approve, with why.
  const error = describeCeremonyFailure(failure, access, flowView.confirmFailure);
  const passkeyUnknown = passkeyUnknownAfter(failure);
  const noAccountHere = noAccountHereAfter(failure);

  return useMemo(
    () => ({
      session,
      store,
      error,
      busy,
      env: deps.env,
      passkey: deps.passkey,
      signIn,
      signUp,
      signOut,
      signUpAccess: access,
      passkeyUnknown,
      noAccountHere,
      stage: flowView.stage,
      approve,
      cancelSignUp,
      hasInvite: inviteToken !== null,
      knownAccount,
      joinedInvite,
    }),
    [
      session,
      store,
      error,
      busy,
      deps,
      signIn,
      signUp,
      signOut,
      access,
      passkeyUnknown,
      noAccountHere,
      flowView.stage,
      approve,
      cancelSignUp,
      inviteToken,
      knownAccount,
      joinedInvite,
    ],
  );
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === "local"
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? "" : "s"})`
    : `Calimero Cloud ${target.cluster}`;
}
