import type { SignUpPolicy } from "@calimero-network/mero-js";
import type { ClientRoutes } from "./routes";

/**
 * Whether this page can create an account on the cluster:
 *
 * - `allowed`: the policy is `open`, or it asks for an invite and the page
 *   holds one (an organization invite's token, captured from `?invite=`).
 * - `needs-invite`: the cluster lets in invited people only and the page holds
 *   no token.
 * - `closed`: only a cluster sign-up invite the operator or the owner minted
 *   admits; an organization invite does not.
 * - `unknown`: the policy could not be read (a node without `GET /sign-up`, or
 *   it did not answer). Nothing is blocked; the node still refuses a sign-up
 *   its policy does not take, before any passkey prompt.
 *
 * Sign-up always makes a NEW passkey: WebAuthn cannot register a credential
 * made on another cluster, so the browser lists the new one beside the old.
 */
export type SignUpAccess = "allowed" | "needs-invite" | "closed" | "unknown";

const POLICIES = new Set(["open", "invite", "closed"]);

/**
 * The cluster's sign-up policy (`GET /sign-up`, no session needed), or `null`
 * when it cannot be read: a node too old to have the route (`404`), a client
 * without `deployments.signUpPublic`, an answer that is not a policy, or any failure.
 */
export async function readSignUpPolicy(
  client: Partial<ClientRoutes<{ deployments: "signUpPublic" }>>,
): Promise<SignUpPolicy | null> {
  const read = client.deployments?.signUpPublic;
  if (typeof read !== "function") return null;
  try {
    const policy: SignUpPolicy = await read.call(client.deployments);
    return policy && POLICIES.has(policy.policy) ? policy : null;
  } catch {
    return null;
  }
}

/** {@link SignUpAccess} for `policy` (null/undefined: unread) and whether the page holds an invite token. */
export function signUpAccess(policy: SignUpPolicy | null | undefined, hasInvite: boolean): SignUpAccess {
  if (!policy) return "unknown";
  if (policy.policy === "closed") return "closed";
  if (!policy.inviteRequired) return "allowed";
  return hasInvite && policy.orgInvites ? "allowed" : "needs-invite";
}

/** A cluster that takes new accounts with an invite only, and the page has none. */
export const SIGN_UP_INVITE_ONLY =
  "This cluster lets in invited people only: open the invite link you were sent, or ask the cluster's owner for one.";

/** A cluster that takes no new accounts but with an operator's sign-up invite. */
export const SIGN_UP_CLOSED = "This cluster isn't open to new accounts: ask its operator for a sign-up invite.";

/** Why creating an account is not offered here, or `null` when it is (or may be). */
export function signUpNotice(access: SignUpAccess): string | null {
  if (access === "needs-invite") return SIGN_UP_INVITE_ONLY;
  if (access === "closed") return SIGN_UP_CLOSED;
  return null;
}

/**
 * The invite token to send with a sign-up (`signUp(..., { invite })`): the
 * page's token where the policy requires an invite and takes this one, else
 * `null`. On an open cluster the token is not spent at sign-up: the app
 * redeems it afterwards, as it always has.
 */
export function signUpInvite(policy: SignUpPolicy | null | undefined, invite: string | null): string | null {
  return policy?.inviteRequired && invite !== null && signUpAccess(policy, true) === "allowed" ? invite : null;
}
