/**
 * One sign-in and one sign-up, the same in every app, with no framework:
 * `usePasskeySession` (React) builds on it, and so do the apps that keep their
 * own session (mero-chat's module store, the merraria and mero-blocks DOM
 * launchers). What it settles, so no app decides it again:
 *
 * - **This cluster's passkeys.** A sign-in offers only the passkeys this
 *   browser has seen work on the cluster ({@link thisClusterPasskey}), and a
 *   sign-up's approval is remembered the same way.
 * - **An account here.** A sign-in or sign-up that worked leaves a hint
 *   ({@link accountHintKey}), so an invited person who has an account sees
 *   "Sign in" first ({@link knownAccountHere}).
 * - **No account here.** A sign-in the cluster has no account for
 *   (`PASSKEY_UNKNOWN_HERE`), or a prompt closed with nothing to choose, is
 *   "create one here", not an error ({@link noAccountHereAfter}).
 * - **The invite at sign-up.** With `join`, the page's invite goes with the
 *   sign-up wherever the cluster's policy lets an organization invite admit
 *   (an `open` cluster too), so the new account joins in that one step
 *   ({@link signUpHere}).
 * - **What a failure says** ({@link describeCeremonyFailure}).
 */
import type { CalimeroClient, PasskeyProvider, SignUpPolicy } from "@calimero-network/mero-js";
import {
  describeSignInError,
  isPasskeyUnknownHere,
  PROMPT_BLOCKED_MESSAGE,
  signUpInvite,
  targetKey,
  type KeyValueStorage,
  type SignUpAccess,
  type Target,
} from "@calimero-apps/connect";
import { thisClusterPasskey } from "./knownPasskeys";
import { describeSignUpNotFinished, isPasskeyCancel, isPromptStuck, signUpFlow, type SignUpFlow } from "./signUpFlow";

/** Said under "Sign in with passkey": which passkeys work here. */
export const SIGN_IN_HINT =
  "Use a passkey made for this cluster, in the Calimero console or any app on it. Passkeys made for other clusters do not work here.";

/**
 * Said, in place of an error, when an invited person's sign-in found no
 * account here: the way on is to create one, and the invite is kept.
 */
export function noAccountCopy(joining: string | undefined, unknownPasskey: boolean): string {
  const to = joining ? `join ${joining}` : "accept the invite";
  return unknownPasskey
    ? `That passkey has no account on this cluster yet. Create your account to ${to}: your invite is kept.`
    : `No passkey for this cluster was chosen. If you are new here, create your account to ${to}: your invite is kept.`;
}

/** Where a browser keeps the passkeys it has seen work on `target` ({@link thisClusterPasskey}; ids, never a credential). */
export function knownPasskeysKey(target: Target): string {
  return `calimero-passkeys:${targetKey(target)}`;
}

/** Where a browser remembers that it has signed in to an account on `target` (a hint, never a credential). */
export function accountHintKey(target: Target): string {
  return `calimero-account:${targetKey(target)}`;
}

function pageStorage(storage: KeyValueStorage | undefined): KeyValueStorage | undefined {
  if (storage) return storage;
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  } catch {
    return undefined;
  }
}

/** This browser has signed in to an account on `target` before. */
export function knownAccountHere(target: Target, storage?: KeyValueStorage): boolean {
  try {
    return pageStorage(storage)?.getItem(accountHintKey(target)) === "1";
  } catch {
    return false;
  }
}

/** Remember that this browser has an account on `target`. */
export function rememberAccountHere(target: Target, storage?: KeyValueStorage): void {
  try {
    pageStorage(storage)?.setItem(accountHintKey(target), "1");
  } catch {
    // Storage blocked: the next visit only starts on the sign-up side.
  }
}

/** `passkey`, offering at a sign-in only the passkeys seen working on `target`. */
export function passkeyHere(passkey: PasskeyProvider, target: Target, storage?: KeyValueStorage): PasskeyProvider {
  return thisClusterPasskey(passkey, knownPasskeysKey(target), pageStorage(storage));
}

/** What a sign-up made with the page's invite joined: the token, and the organization when it can be told. */
export interface JoinedAtSignUp {
  invite: string;
  org: string | null;
}

/**
 * The invite a sign-up carries. With `join`, the page's token unless the
 * cluster's policy says an organization invite cannot admit (`closed`); an
 * unread policy sends it, since the node judges it before anything is spent.
 * Without, only a cluster that requires an invite gets one.
 */
export function signUpInviteHere(policy: SignUpPolicy | null | undefined, invite: string | null, join: boolean): string | null {
  if (invite === null) return null;
  if (!join || (policy && (policy.policy === "closed" || !policy.orgInvites))) return signUpInvite(policy, invite);
  return invite;
}

/** The organization a brand-new account is in: the one its invite joined. */
export async function soleOrg(client: Pick<CalimeroClient, "me">): Promise<string | null> {
  try {
    const me = (await client.me()) as { orgs?: Array<{ orgId?: unknown }> };
    const orgs = (me.orgs ?? []).map((o) => o.orgId).filter((o): o is string => typeof o === "string");
    return orgs.length === 1 ? (orgs[0] as string) : null;
  } catch {
    return null;
  }
}

/**
 * Ends an open passkey prompt: mero-js forwards it to the browser's
 * `navigator.credentials` call (and a sign-up's confirm prompt, which then
 * throws `ConfirmCancelled`) from the release that takes it. With an older
 * mero-js the option is ignored and Cancel still works at the Approve step.
 */
export interface CeremonySignal {
  signal?: AbortSignal;
}

type SignInWithSignal = (passkey: PasskeyProvider, options?: CeremonySignal) => Promise<{ accountId: string }>;
type SignUpWithSignal = (
  passkey: PasskeyProvider,
  name: string,
  options?: { invite?: string } & CeremonySignal,
) => Promise<{ accountId: string }>;

/** Sign in on `target` offering only its passkeys; remembers the account here. */
export async function signInHere(
  client: Pick<CalimeroClient, "signIn">,
  target: Target,
  passkey: PasskeyProvider,
  storage?: KeyValueStorage,
  { signal }: CeremonySignal = {},
): Promise<{ accountId: string }> {
  // Typed loosely: the installed mero-js may not take `signal` yet.
  const signIn = client.signIn.bind(client) as unknown as SignInWithSignal;
  const here = passkeyHere(passkey, target, storage);
  const { accountId } = signal ? await signIn(here, { signal }) : await signIn(here);
  rememberAccountHere(target, storage);
  return { accountId };
}

/**
 * A sign-up's {@link signUpFlow} on `target`: its second prompt right away,
 * Approve only as a fallback, and the new passkey remembered as this
 * cluster's. Pass its `passkey` to {@link signUpHere}.
 */
export function signUpFlowHere(
  passkey: PasskeyProvider,
  target: Target,
  storage: KeyValueStorage | undefined,
  onChange: () => void = () => {},
): SignUpFlow {
  return signUpFlow(passkeyHere(passkey, target, storage), onChange);
}

export interface SignUpHereOptions extends CeremonySignal {
  /** The new account's name; optional. */
  name?: string;
  /** The invite token the page holds, if any. */
  invite?: string | null;
  /** The cluster's sign-up policy as read (`undefined` until then). */
  policy?: SignUpPolicy | null;
  /** Carry the invite wherever an organization invite admits, and report the join ({@link signUpInviteHere}). */
  join?: boolean;
  /**
   * Also show `name` in the organization the invite joined (its member
   * metadata, which that org's people lists read). Off by default: an app that
   * asks for a name per organization itself (a game's "your name in this
   * world") keeps asking.
   */
  nameInOrg?: boolean;
  storage?: KeyValueStorage;
}

/**
 * Create an account on `target` with `passkey` (a {@link signUpFlowHere}'s).
 * `joined` is set when the page's invite went with it and `join` asked for
 * that: the account is in the invite's organization, and nothing is left to
 * redeem (redeeming again would spend another use).
 */
export async function signUpHere(
  client: Pick<CalimeroClient, "signUp" | "me"> & Partial<Pick<CalimeroClient, "setMemberMetadata">>,
  target: Target,
  passkey: PasskeyProvider,
  options: SignUpHereOptions = {},
): Promise<{ accountId: string; joined: JoinedAtSignUp | null }> {
  const { name = "", invite = null, policy, join = false, nameInOrg = false, storage, signal } = options;
  const carried = signUpInviteHere(policy, invite, join);
  const trimmed = name.trim();
  // Typed loosely: the installed mero-js may not take `signal` yet.
  const signUp = client.signUp.bind(client) as unknown as SignUpWithSignal;
  const extra = { ...(carried ? { invite: carried } : {}), ...(signal ? { signal } : {}) };
  const made = Object.keys(extra).length ? await signUp(passkey, trimmed, extra) : await signUp(passkey, trimmed);
  const { accountId } = made;
  rememberAccountHere(target, storage);
  // The org from the sign-up's answer when the node names it there (mero-js
  // passes the node's answer through), else the new account's only one.
  const said = (made as { org?: unknown }).org;
  const joined =
    carried && join
      ? { invite: carried, org: typeof said === "string" && said ? said : await soleOrg(client) }
      : null;
  if (nameInOrg && joined?.org && trimmed) await nameJoinedOrg(client, joined.org, accountId, trimmed);
  return { accountId, joined };
}

/**
 * Shows a new account as `name` in the organization its invite joined: the
 * org's member metadata `{ name }`, which its people lists read (the account's
 * own name is seen by no one else). Best effort: the account and the join
 * stand without it, and the person can name themselves later.
 */
async function nameJoinedOrg(
  client: Partial<Pick<CalimeroClient, "setMemberMetadata">>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  if (typeof client.setMemberMetadata !== "function") return;
  try {
    await client.setMemberMetadata(org, account, { name });
  } catch {
    /* unnamed in the org until they name themselves */
  }
}

/** A failed sign-in or sign-up, kept to be described when shown (the policy may be read after it). */
export interface CeremonyFailure {
  error: unknown;
  during: "sign-in" | "sign-up";
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

/** The last sign-in failed because the cluster has no account for that passkey. */
export function passkeyUnknownAfter(failure: CeremonyFailure | null): boolean {
  return failure !== null && isPasskeyUnknownHere(failure.error);
}

/**
 * The last sign-in found no account here: the cluster did not know the
 * passkey, or the prompt closed with none chosen (a browser with no passkey
 * for this cluster shows nothing to pick). Creating an account is the way on.
 */
export function noAccountHereAfter(failure: CeremonyFailure | null): boolean {
  if (failure?.during !== "sign-in") return false;
  return isPasskeyUnknownHere(failure.error) || (isPasskeyCancel(failure.error) && isNotAllowed(failure.error));
}

/**
 * What to show for a ceremony, `null` for nothing: a sign-up waiting at
 * Approve says why its approval failed ({@link describeSignUpNotFinished});
 * a dismissed prompt is a quiet cancel; a blocked one says what is in the
 * way; anything else is said by the cluster's sign-up policy.
 */
export function describeCeremonyFailure(
  failure: CeremonyFailure | null,
  access: SignUpAccess,
  confirmFailure: { error: unknown } | null = null,
): string | null {
  if (confirmFailure) return describeSignUpNotFinished(confirmFailure.error);
  if (!failure || isPasskeyCancel(failure.error)) return null;
  if (isPromptStuck(failure.error)) return PROMPT_BLOCKED_MESSAGE;
  return describeSignInError(failure.error, access);
}

/**
 * What an invited visitor sees first: "create" when this browser knows no
 * account here (or a sign-in just found none), "sign-in" when it does.
 */
export function invitedFirst(knownAccount: boolean, noAccountHere: boolean): "create" | "sign-in" {
  return noAccountHere || !knownAccount ? "create" : "sign-in";
}
