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
  describeSignInError,
  isPasskeyUnknownHere,
  readSignUpPolicy,
  signUpAccess,
  signUpInvite,
  type ConnectEnv,
  type SignUpAccess,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";
import { describeSignUpNotFinished, signUpFlow, type SignUpFlow, type SignUpStage } from "./signUpFlow";

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
  /** Sign in with a passkey the person already has (any Calimero app's). */
  signIn(): Promise<void>;
  /**
   * Create an account with a new passkey. The name is optional. On a cluster
   * that requires an invite, the page's invite token goes with it.
   */
  signUp(name?: string): Promise<void>;
  /**
   * Where a sign-up is (`SignUpStage`), `null` outside one. At `approve` the
   * new passkey exists and the account waits for `approve()`: its second
   * prompt starts from a click of its own, so a password manager extension
   * still saving the passkey cannot refuse it. Optional, like the fields
   * below, so a session an app builds itself still fits.
   */
  stage?: SignUpStage | null;
  /** The click that creates the account with the new passkey (at `stage: "approve"`). */
  approve?(): void;
  /** Give up the sign-up at its Approve step. Quiet: no error is shown. */
  cancelSignUp?(): void;
  /**
   * Whether this page may create an account on the cluster, from its sign-up
   * policy (read once the client connects) and the page's invite token:
   * `unknown` until read, or when the node cannot say. Optional, so a session
   * an app or a test builds itself still fits; missing reads as `unknown`.
   */
  signUpAccess?: SignUpAccess;
  /** The last sign-in failed because the cluster has no account for that passkey. */
  passkeyUnknown?: boolean;
  signOut(): Promise<void>;
}

/**
 * A dismissed or timed-out passkey prompt. The person chose not to go on, so
 * it is a quiet cancel, not an error to show.
 */
export function isPasskeyCancel(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const name = (e as { name?: unknown }).name;
    if (name === "NotAllowedError" || name === "AbortError" || name === "ConfirmCancelled" || name === "SignUpCancelled") {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

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
   */
  invite?: () => string | null;
}

/**
 * Connects to the local nodes (dev) or the Cloud cluster (production: named by
 * the build, else the one serving the page, else the package's primary cluster
 * in the directory), restores a stored session for `app`, and signs in or up
 * with a passkey.
 */
export function usePasskeySession(app: string, deps: SessionDeps, options: PasskeySessionOptions = {}): SessionApi {
  const { package: pkg, invite } = options;
  const [session, setSession] = useState<Session>({ status: "connecting" });
  const [store, setStore] = useState<SessionStore | null>(null);
  // The failed ceremony's error, described at render time so the words follow
  // the sign-up policy even when it is read after the failure.
  // `afterCreate`: the sign-up's passkey was made, so even a cancel-like
  // failure is shown (the person has a passkey and no account).
  const [failure, setFailure] = useState<{ error: unknown; afterCreate?: boolean } | null>(null);
  /** The sign-up in flight, if any, and what the control shows of it. */
  const flowRef = useRef<SignUpFlow | null>(null);
  const [flowView, setFlowView] = useState<{ stage: SignUpStage | null; confirmFailure: { error: unknown } | null }>(
    { stage: null, confirmFailure: null },
  );
  const [busy, setBusy] = useState(false);
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
  }, [app, deps, pkg]);

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

  // Leaving the page mid sign-up ends it, so nothing waits on a click.
  useEffect(() => () => flowRef.current?.cancel(), []);

  const ceremony = useCallback(
    async (run: (client: CalimeroClient) => Promise<{ accountId: string }>, flow?: SignUpFlow) => {
      if (session.status !== "signed-out") return;
      setBusy(true);
      setFailure(null);
      if (flow) flowRef.current = flow;
      try {
        // mero-js forgets the session when `/auth/logout` returns, so a sign-in
        // that finished first would be wiped by the sign-out before it.
        await loggingOut.current;
        const { accountId } = await run(session.client);
        store?.sync(session.client);
        setSession({ status: "signed-in", client: session.client, target: session.target, accountId });
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
    [session, store],
  );

  const signIn = useCallback(() => ceremony((c) => c.signIn(deps.passkey())), [ceremony, deps]);
  const invited = signUpInvite(policy, inviteToken);
  const signUp = useCallback(
    (name?: string) => {
      const flow: SignUpFlow = signUpFlow(deps.passkey(), () =>
        setFlowView({ stage: flow.stage, confirmFailure: flow.confirmFailure }),
      );
      return ceremony(
        (c) =>
          invited
            ? c.signUp(flow.passkey, name?.trim() ?? "", { invite: invited })
            : c.signUp(flow.passkey, name?.trim() ?? ""),
        flow,
      );
    },
    [ceremony, deps, invited],
  );
  const approve = useCallback(() => flowRef.current?.approve(), []);
  const cancelSignUp = useCallback(() => flowRef.current?.cancel(), []);

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

  const error = flowView.confirmFailure
    ? describeSignUpNotFinished(flowView.confirmFailure.error)
    : failure
      ? failure.afterCreate
        ? describeSignUpNotFinished(failure.error, true)
        : describeSignInError(failure.error, access)
      : null;
  const passkeyUnknown = failure !== null && isPasskeyUnknownHere(failure.error);

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
      stage: flowView.stage,
      approve,
      cancelSignUp,
    }),
    [session, store, error, busy, deps, signIn, signUp, signOut, access, passkeyUnknown, flowView.stage, approve, cancelSignUp],
  );
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === "local"
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? "" : "s"})`
    : `Calimero Cloud ${target.cluster}`;
}
