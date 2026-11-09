import {
  AppError,
  CalimeroClient,
  CalimeroError,
  ConfirmCancelled,
  ConfirmPromptBlocked,
  DirectoryError,
  LoginRequired,
  SignUpRefused,
  TrapError,
  UnavailableError,
  type CalimeroSession,
} from "@calimero-network/mero-js";

import { describeInviteRefusal, inviteRefusal } from "./invite";
import { SIGN_UP_CLOSED, SIGN_UP_INVITE_ONLY, signUpNotice, type SignUpAccess } from "./signUp";
import { policyFor, targetKey, type Target } from "./target";

export interface ClientOptions {
  /** Fetch for the directory, attestation and sealed requests (tests). */
  fetch?: typeof fetch;
}

/**
 * A `CalimeroClient` for `target`: the local nodes, failing over in order, or
 * the cloud cluster through the node directory, failing over across the nodes
 * it lists. Every node is attested under {@link policyFor} before anything is
 * sent to it.
 */
export async function createClient(target: Target, options: ClientOptions = {}): Promise<CalimeroClient> {
  const policy = policyFor(target);
  const fetcher = options.fetch ? { fetch: options.fetch } : {};
  if (target.kind === "local") {
    const [baseUrl, ...nodes] = target.nodes;
    if (!baseUrl) throw new Error("a local target needs at least one node");
    return new CalimeroClient({ baseUrl, nodes, policy, ...fetcher });
  }
  if (target.nodes && target.nodes.length > 0) {
    // Served by the cluster: its own list, same failover, no directory.
    const [baseUrl, ...nodes] = target.nodes;
    return new CalimeroClient({ baseUrl: baseUrl as string, nodes, policy, ...fetcher });
  }
  return CalimeroClient.connect({
    cluster: target.cluster,
    policy,
    ...(target.zone ? { zone: target.zone } : {}),
    ...(target.directory ? { directory: target.directory } : {}),
    ...fetcher,
  });
}

/** The `Storage` methods the session store uses (`localStorage` in a browser). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isSession(value: unknown): value is CalimeroSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accountId === "string" &&
    typeof v.sessionToken === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.expiresAt === "number"
  );
}

/**
 * The signed-in session, kept per app and per target, so a dev session never
 * reaches a cloud cluster and two apps on one origin do not share one.
 *
 * The refresh token is single-use: the client swaps it on a `401` and holds
 * the new session, so call {@link SessionStore.sync} after requests (or let
 * {@link SessionStore.watch} do it) to keep the stored copy current. A stale
 * copy only costs a sign-in on the next load.
 */
export class SessionStore {
  readonly key: string;
  private last: string | null = null;

  constructor(
    app: string,
    target: Target,
    private readonly storage: KeyValueStorage | undefined = globalThis.localStorage,
  ) {
    this.key = `calimero-session:${app}:${targetKey(target)}`;
  }

  load(): CalimeroSession | null {
    try {
      const raw = this.storage?.getItem(this.key) ?? null;
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isSession(parsed)) {
        this.clear();
        return null;
      }
      this.last = raw;
      return parsed;
    } catch {
      return null;
    }
  }

  save(session: CalimeroSession): void {
    const raw = JSON.stringify(session);
    if (raw === this.last) return;
    this.last = raw;
    try {
      this.storage?.setItem(this.key, raw);
    } catch {
      // Storage full or blocked (private mode): the session lives for this page only.
    }
  }

  clear(): void {
    this.last = null;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* nothing stored */
    }
  }

  /** Stores the client's session if it has one and it changed. */
  sync(client: Pick<CalimeroClient, "session">): void {
    const session = client.session;
    if (session) this.save(session);
  }

  /** Puts a stored session on `client`; `true` when there was one. */
  restore(client: Pick<CalimeroClient, "useSession">): boolean {
    const session = this.load();
    if (!session) return false;
    client.useSession(session);
    return true;
  }
}

/**
 * A passkey prompt the browser or a password manager blocked: another prompt,
 * or a password manager's popup, still open (mero-js's `ConfirmPromptBlocked`).
 * Not a cancel: the person did not choose it, and can clear it.
 */
export const PROMPT_BLOCKED_MESSAGE =
  "The passkey prompt was blocked: another passkey prompt or a password manager's popup is still open. " +
  "Finish or close it, then try again.";

/** A one-line, user-facing account of a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof AppError) {
    const fields = Object.keys(error.fields).length ? ` ${JSON.stringify(error.fields)}` : "";
    return `${error.appCode}${fields}`;
  }
  if (error instanceof TrapError) return `the app aborted the call (${error.kind || "trap"})`;
  if (error instanceof LoginRequired) return "Sign in first.";
  if (error instanceof ConfirmCancelled) return "The passkey prompt was cancelled.";
  if (error instanceof ConfirmPromptBlocked) return PROMPT_BLOCKED_MESSAGE;
  if (error instanceof UnavailableError) return "The cluster is unavailable; try again shortly.";
  if (error instanceof DirectoryError) return `No node of the cluster could be found: ${error.message}`;
  if (error instanceof CalimeroError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * What a person is told when the cluster has no account for the passkey they
 * used and its sign-up policy is not known.
 */
export const PASSKEY_UNKNOWN_HERE_MESSAGE =
  "This passkey isn't known on this cluster: create a new passkey here, or use one you made on this cluster.";

/** The same, on a cluster that lets this page create an account. */
export const PASSKEY_UNKNOWN_SIGN_UP_MESSAGE =
  "This passkey isn't known on this cluster. Create an account here: it makes a new passkey for this cluster.";

/** The node's own words in a refusal, without mero-js's `"{status} {code}: "` prefix. */
function nodeMessage(error: CalimeroError): string {
  const prefix = `${error.status} ${error.code}: `;
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

/**
 * A sign-in with a passkey the cluster has no account for (made on another
 * cluster, or before this one was recreated; every cluster shares one rp id,
 * so the browser offers it anyway): `401 UNAUTHENTICATED "unknown passkey"`,
 * or, from core's `PASSKEY_UNKNOWN_HERE` on, that code (mero-js's
 * `PasskeyUnknownHere`).
 */
export function isPasskeyUnknownHere(error: unknown): boolean {
  if (!(error instanceof CalimeroError)) return false;
  if (error.code === "PASSKEY_UNKNOWN_HERE" || error.name === "PasskeyUnknownHere") return true;
  return error instanceof LoginRequired && nodeMessage(error) === "unknown passkey";
}

/** `403 SIGN_UP_REFUSED`, by its reason, in the same words as the policy. */
function describeSignUpRefused(error: SignUpRefused): string {
  switch (error.reason) {
    case "invite-only":
      return SIGN_UP_INVITE_ONLY;
    case "closed":
      return SIGN_UP_CLOSED;
    default: {
      // The invite's own refusal, also in core's newer words ({@link inviteRefusal}).
      const refusal = inviteRefusal(error);
      if (refusal) return describeInviteRefusal(refusal);
      return `This cluster refused the sign-up: ${nodeMessage(error) || "no reason given"}`;
    }
  }
}

/**
 * {@link describeError} for a failed sign-in or sign-up (`signIn`/`signUp`).
 * The person is not signed in yet, so "Sign in first." says nothing: the node's
 * `401` there is about the passkey, and its reason is what helps.
 *
 * `access` is what the cluster's sign-up policy lets this page do
 * (`signUpAccess`): a passkey unknown here is then answered with the way in
 * (create an account here, or why that is not possible). Without it, or
 * `unknown`, the general wording. A refused sign-up (`SignUpRefused`) says
 * why in the same words.
 */
export function describeSignInError(error: unknown, access: SignUpAccess = "unknown"): string {
  if (isPasskeyUnknownHere(error)) {
    if (access === "allowed") return PASSKEY_UNKNOWN_SIGN_UP_MESSAGE;
    const notice = signUpNotice(access);
    return notice ? `This passkey isn't known on this cluster. ${notice}` : PASSKEY_UNKNOWN_HERE_MESSAGE;
  }
  if (error instanceof SignUpRefused) return describeSignUpRefused(error);
  if (error instanceof LoginRequired) {
    return `The cluster refused this passkey: ${nodeMessage(error) || "no reason given"}`;
  }
  return describeError(error);
}
