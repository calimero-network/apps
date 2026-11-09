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
  targetKey,
  type ConnectEnv,
  type SignUpAccess,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";

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

/**
 * Where a sign-up is: `create` while the browser makes the new passkey,
 * `ready` once it is made and the page waits for the person's click to
 * approve with it, `confirm` while the browser asks for that approval. Core
 * asks the new passkey to sign the account it creates (`412
 * CONFIRM_REQUIRED`), so a sign-up is two browser prompts.
 */
export type SignUpStage = "create" | "ready" | "confirm";

/** What a sign-up made with the page's invite joined: the token, and the organization when it can be told. */
export interface JoinedAtSignUp {
  invite: string;
  org: string | null;
}

/**
 * `passkey`, reporting each prompt to `onStage`: `create` before the new
 * passkey is made, `confirm` before it is asked to sign the account.
 *
 * With `beforeConfirm`, the second prompt waits for it: the page resolves it
 * when the person clicks "Approve with your new passkey", so the prompt is
 * started by a click of its own and not a moment after the first one closed.
 * A password manager extension that answers passkey prompts is still saving
 * the new passkey then and refuses the second ("A request is already
 * pending"), and Safari wants a click before each prompt. `onStage('ready')`
 * says the click is awaited. The Calimero Cloud console does the same.
 */
export function stagedPasskey(
  passkey: PasskeyProvider,
  onStage: (stage: SignUpStage) => void,
  beforeConfirm?: () => Promise<void>,
): PasskeyProvider {
  return {
    create: (options) => {
      onStage("create");
      return passkey.create(options);
    },
    get: async (challenge, rpId, allowCredentials) => {
      if (beforeConfirm) {
        onStage("ready");
        await beforeConfirm();
      }
      onStage("confirm");
      return passkey.get(challenge, rpId, allowCredentials);
    },
  };
}

/**
 * Said when a sign-up's second prompt (the approval with the new passkey) was
 * cancelled: the account is only made once that approval is given.
 */
export const SIGN_UP_UNFINISHED =
  "The approval was cancelled, so no account was made. Create your account again to finish: your browser may list the unused passkey, which you can delete.";

/** Where a browser remembers that it has signed in to an account on `target` (a hint, never a credential). */
export function accountHintKey(target: Target): string {
  return `calimero-account:${targetKey(target)}`;
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
  signUpStage?: SignUpStage | null;
  /** Starts a sign-up's second prompt, once it is `ready`. */
  approve?(): void;
  /** Gives up a sign-up waiting at `ready`: no account is made. */
  cancelApproval?(): void;
  /** Whether the page holds an invite token. */
  hasInvite?: boolean;
  /** This browser has signed in to an account on this cluster before (a hint kept in storage). */
  knownAccount?: boolean;
  /** The invite token a sign-up from this page spent to join, once it has. */
  joinedInvite?: string | null;
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
    if (name === "NotAllowedError" || name === "AbortError" || name === "ConfirmCancelled") return true;
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
   * Whether a sign-up's second prompt waits for a click ({@link stagedPasskey},
   * `approve`). On by default; a caller with no button to show turns it off.
   */
  approveWithClick?: boolean;
}

/**
 * The invite a sign-up carries when it is to join with it: the page's token
 * unless the cluster's policy says an organization invite cannot admit
 * (`closed`). An unread policy sends it: the node judges it before anything
 * is spent.
 */
function joinInvite(policy: SignUpPolicy | null | undefined, invite: string | null): string | null {
  if (invite === null) return null;
  if (policy && (policy.policy === "closed" || !policy.orgInvites)) return signUpInvite(policy, invite);
  return invite;
}

/** The organization a brand-new account is in: the one its invite joined. */
async function soleOrg(client: CalimeroClient): Promise<string | null> {
  try {
    const me = (await client.me()) as { orgs?: Array<{ orgId?: unknown }> };
    const orgs = (me.orgs ?? []).map((o) => o.orgId).filter((o): o is string => typeof o === "string");
    return orgs.length === 1 ? (orgs[0] as string) : null;
  } catch {
    return null;
  }
}

function readHint(storage: KeyValueStorage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeHint(storage: KeyValueStorage | undefined, key: string): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    // Storage blocked: the next visit only starts on the sign-up side.
  }
}

/** A cancelled prompt with no credential chosen: what a browser with no passkey for the cluster answers. */
function isNotAllowed(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    if ((e as { name?: unknown }).name === "NotAllowedError") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

interface Failure {
  error: unknown;
  during: "sign-in" | "sign-up";
  /** The prompt was dismissed, timed out or aborted. */
  cancelled: boolean;
  /** A sign-up's stage when it failed. */
  stage: SignUpStage | null;
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
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<SignUpStage | null>(null);
  const [knownAccount, setKnownAccount] = useState(false);
  const [joinedInvite, setJoinedInvite] = useState<string | null>(null);
  /** A sign-up waiting at `ready` for the click that starts its second prompt. */
  const approval = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
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
        setKnownAccount(readHint(hintStorage, accountHintKey(target)));
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
      during: Failure["during"],
      run: (client: CalimeroClient) => Promise<{ accountId: string }>,
      stageNow: () => SignUpStage | null = () => null,
    ) => {
      if (session.status !== "signed-out") return;
      setBusy(true);
      setFailure(null);
      try {
        // mero-js forgets the session when `/auth/logout` returns, so a sign-in
        // that finished first would be wiped by the sign-out before it.
        await loggingOut.current;
        const { accountId } = await run(session.client);
        store?.sync(session.client);
        writeHint(hintStorage, accountHintKey(session.target));
        setKnownAccount(true);
        setSession({ status: "signed-in", client: session.client, target: session.target, accountId });
      } catch (e) {
        setFailure({ error: e, during, cancelled: isPasskeyCancel(e), stage: stageNow() });
      } finally {
        approval.current = null;
        setStage(null);
        setBusy(false);
      }
    },
    [session, store, hintStorage],
  );

  const signIn = useCallback(() => ceremony("sign-in", (c) => c.signIn(deps.passkey())), [ceremony, deps]);
  // With `onJoinedAtSignUp` the app hands the invite's join to the sign-up;
  // without it, only a cluster that requires an invite gets one.
  const invited = onJoinedAtSignUp ? joinInvite(policy, inviteToken) : signUpInvite(policy, inviteToken);
  const signUp = useCallback(
    (name?: string) => {
      let current: SignUpStage | null = null;
      const onStage = (s: SignUpStage) => {
        current = s;
        setStage(s);
      };
      const beforeConfirm = approveWithClick
        ? () =>
            new Promise<void>((resolve, reject) => {
              approval.current = { resolve, reject };
            })
        : undefined;
      return ceremony(
        "sign-up",
        async (c) => {
          const passkey = stagedPasskey(deps.passkey(), onStage, beforeConfirm);
          const made = invited
            ? await c.signUp(passkey, name?.trim() ?? "", { invite: invited })
            : await c.signUp(passkey, name?.trim() ?? "");
          if (invited && joined.current) {
            const org = await soleOrg(c);
            setJoinedInvite(invited);
            joined.current({ invite: invited, org });
          }
          return made;
        },
        () => current,
      );
    },
    [ceremony, deps, invited, approveWithClick],
  );

  const approve = useCallback(() => {
    const waiting = approval.current;
    approval.current = null;
    waiting?.resolve();
  }, []);
  const cancelApproval = useCallback(() => {
    const waiting = approval.current;
    approval.current = null;
    if (waiting) {
      const e = new Error("The approval was cancelled.");
      e.name = "AbortError";
      waiting.reject(e);
    }
  }, []);

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
  const unfinished = failure?.during === "sign-up" && failure.cancelled && failure.stage !== null && failure.stage !== "create";
  const error = !failure
    ? null
    : unfinished
      ? SIGN_UP_UNFINISHED
      : failure.cancelled
        ? null
        : describeSignInError(failure.error, access);
  const passkeyUnknown = failure !== null && isPasskeyUnknownHere(failure.error);
  const noAccountHere =
    failure?.during === "sign-in" && (passkeyUnknown || (failure.cancelled && isNotAllowed(failure.error)));

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
      signUpStage: stage,
      approve,
      cancelApproval,
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
      stage,
      approve,
      cancelApproval,
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
