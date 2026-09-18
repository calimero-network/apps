/**
 * The three legs of delegated execution, each as one function the UI can put
 * behind a button.
 *
 * This is deliberately thin. Every hard part — the borsh layouts, the signing
 * domains, the request shapes — lives in mero-js, and a demo that re-encoded
 * any of it would be testing its own copy rather than the thing being
 * demonstrated. What this file adds is the *ordering* and the error messages:
 * which step comes first, what a given refusal actually means, and what the
 * operator has to go and do about it.
 *
 * The legs, and why they use different transports:
 *
 * 1. **Session** — `login()`. A challenge, a statement signed by the device
 *    key, a token. No password exists in this path.
 * 2. **Read** — the session's bearer token against `POST .../query`. A session
 *    authorises reads and nothing else, which is why the write does not use it.
 * 3. **Write** — a warrant, spent through `RelayClient`. The token plays no
 *    part: what authorises the write is the author's signature over this exact
 *    method and these exact arguments, which is why the relay can run it
 *    without being trusted with anything.
 */

import {
  CloudClient,
  HTTPError,
  RelayClient,
  accountRootFromSecret,
  createLocalStorageNonceSource,
  login,
  routingProofHeaders,
  signAccountLogin,
  signMemberJoinOp,
  type CloudAccountRelay,
  type DelegatedSession,
  type IntentResult,
} from '@calimero-network/mero-js';

import {
  chooseAdmitter,
  chooseExecutor,
  classifyNodes,
  type ClassifiedNode,
  type RoutableNode,
} from './admission.js';

import type { DeviceIdentity } from './identity.js';
import { joinNonceStorageKey, nonceStorageKey } from './storage.js';

/** Strip a trailing slash so a pasted URL and a typed one address the same node. */
function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Obtain a session on a node this device does not own.
 *
 * `audience` is this tab's own origin, spelled exactly as the browser spells
 * it. The node compares it byte for byte, so normalising it here would mean a
 * client that disagrees with its own browser about which origin a token was
 * for. The node has to list that origin in `allowed_audiences` — see the
 * README; an origin the node does not know is a 401 that reads like a bad
 * signature.
 */
export async function openSession(
  nodeUrl: string,
  nodeKey: string,
  identity: DeviceIdentity,
): Promise<DelegatedSession> {
  return login({
    nodeUrl: normaliseUrl(nodeUrl),
    node: nodeKey,
    deviceSecret: identity.deviceSecret,
    accountProof: identity.credential,
    audience: { kind: 'webOrigin', origin: window.location.origin },
  });
}

/** What a read returned, alongside the raw body so the demo can show both. */
export interface ReadResult {
  /** The method's return value, as the node sent it. */
  returns: unknown;
  /** The whole response, for the panel that shows what actually came back. */
  raw: unknown;
}

/**
 * Read context state through the session.
 *
 * Posted directly rather than through a mero-js client because there is no
 * client for this route yet: `RpcClient` speaks JSON-RPC as a node member, and
 * `AdminClient` wants a node credential. The delegated read is neither — it is
 * a plain POST carrying a session token, and wrapping thirty lines of `fetch`
 * in a class would not make it clearer.
 */
export async function readContext(
  nodeUrl: string,
  session: DelegatedSession,
  contextId: string,
  method: string,
  argsJson: unknown,
): Promise<ReadResult> {
  const response = await fetch(
    `${normaliseUrl(nodeUrl)}/admin-api/contexts/${encodeURIComponent(contextId)}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ method, argsJson }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(explainReadFailure(response.status, text));
  }

  const body: unknown = text ? JSON.parse(text) : {};
  // The route answers `{ data: { returns } }`, but the node has spelled this
  // both bare and wrapped before. Accept either rather than couple a demo to
  // one envelope revision — and show `raw` regardless, so a shape this does not
  // anticipate is visible rather than silently read as `undefined`.
  const envelope = body as { returns?: unknown; data?: { returns?: unknown } };
  return { returns: envelope.data?.returns ?? envelope.returns, raw: body };
}

/**
 * Turn a read refusal into the thing the operator has to fix.
 *
 * A 403 here means the account is not a member of the context — not that the
 * session is bad, which is what "Forbidden" reads as after a login that just
 * succeeded. That one confusion is most of why this function exists.
 */
function explainReadFailure(status: number, body: string): string {
  const detail = body ? `: ${body}` : '';
  switch (status) {
    case 401:
      return `the session was refused (401)${detail}. The token may have expired — open a new session.`;
    case 403:
      return (
        `the node served the session but refused the read (403)${detail}. ` +
        'This account is not a member of that context: it has to be invited and join.'
      );
    case 404:
      return `no such context on this node (404)${detail}. Check the context id, and that this node has joined it.`;
    default:
      return `the read failed (HTTP ${status})${detail}`;
  }
}

/**
 * Write to the context by minting a warrant and handing it to the relay.
 *
 * A warrant consumes a number from this device's monotonic sequence, and one
 * minted against the wrong executor is unspendable — the number is gone and the
 * write never happened. `RelayClient` therefore learns the executor from the
 * relay before it signs anything, which is why no executor account is passed
 * in here.
 */
export async function writeContext<T = unknown>(
  nodeUrl: string,
  identity: DeviceIdentity,
  contextId: string,
  method: string,
  argsJson: unknown,
): Promise<IntentResult<T>> {
  const relay = new RelayClient({
    relayUrl: normaliseUrl(nodeUrl),
    authorAccount: identity.accountId,
    authorProof: identity.credential,
    deviceSecret: identity.deviceSecret,
    nonces: createLocalStorageNonceSource(nonceStorageKey(identity.devicePublicKey)),
  });
  return relay.execute<T>(contextId, method, argsJson);
}

/**
 * Ask the relay what it can do here, before anything is signed.
 *
 * Worth its own button: it answers "is the relay allowed to author for me"
 * without spending a nonce, and a `canAuthorOnBehalf` of `false` is the single
 * most common reason a first write fails. The node's own account needs
 * `CAN_AUTHOR_ON_BEHALF` on the owning group — a governance op its admin signs.
 */
export async function describeRelay(nodeUrl: string, contextId: string) {
  const relay = new RelayClient({
    relayUrl: normaliseUrl(nodeUrl),
    // `describe` signs nothing and spends nothing, so the author fields are
    // placeholders it never reads. Passing the real ones would suggest this
    // call is about a particular author, and it is not.
    authorAccount: '',
    authorProof: '',
    deviceSecret: '',
    nonces: { next: () => Promise.resolve(0n) },
  });
  return relay.describe(contextId);
}

/**
 * Where to present a signed join, resolved rather than typed.
 *
 * The invitation and the cloud each answer half of this and neither answers
 * both — see `lib/admission.ts` for why the intersection is the answer. This
 * function is the ordering: parse, ask the cloud, classify, choose.
 *
 * It deliberately does not sign or send anything. Discovery being separate from
 * admission is what lets the UI show the operator *which* node it landed on and
 * why the others were rejected, before anything irreversible happens — and a
 * "live but not in your invitation" node is exactly the case worth seeing
 * rather than hitting as a 403.
 *
 * ## Why this needs the identity
 *
 * The routing read is the one cloud call on this path, and the cloud will not
 * answer it anonymously for much longer. It cannot ask for a cloud login — a
 * joiner is not the namespace owner and holding no cloud account is the point —
 * so it asks for a challenge signed by the certified device key instead. That
 * is `routingCredential`, and it is the same credential and secret every other
 * leg of this demo already uses: nothing new is minted, stored or typed.
 *
 * The cloud does not yet *require* it. Sending it anyway is deliberate: a proof
 * that is wrong fails here, now, while the flag is off and the read still
 * succeeds — rather than on the day the flag flips and every client breaks at
 * once.
 */
/**
 * The relays this account is already known to, from the cloud.
 *
 * Proven with the device certificate, not a cloud session — so a browser that
 * holds only a key can ask, which is the whole point of the flow this page
 * demonstrates.
 *
 * **An empty list is the normal answer for a new account, not a failure.** The
 * cloud derives this from the recovery records relays write for members they
 * serve, so an account that has never joined anything has no relay to report.
 * That makes this a *returning device* path: useful when you hold a key and
 * have lost the node address, useless for a first join, which still needs an
 * invitation naming an admitter. The caller must tell a person those two apart,
 * because "no relays yet" and "the lookup failed" look identical otherwise.
 *
 * Usable relays are the ones with a URL and a fresh heartbeat; the rest are
 * returned too, because "your relay is down" and "you have no relay" need
 * different actions and an empty list would erase the difference.
 */
export async function findAccountRelays(
  cloudUrl: string,
  identity: DeviceIdentity,
): Promise<{ usable: CloudAccountRelay[]; others: CloudAccountRelay[] }> {
  const cloud = new CloudClient({
    cloudBaseUrl: normaliseUrl(cloudUrl),
    routingCredential: {
      credential: identity.credential,
      deviceSecret: identity.deviceSecret,
    },
  });
  const relays = await cloud.getAccountRelays(identity.accountId);
  return {
    usable: relays.filter((r) => r.fresh && !!r.relayUrl),
    others: relays.filter((r) => !(r.fresh && r.relayUrl)),
  };
}

export async function discoverAdmitter(
  cloudUrl: string,
  namespaceId: string,
  invitationJson: string,
  identity: DeviceIdentity,
): Promise<{
  classified: ClassifiedNode[];
  chosen: RoutableNode | null;
  reason: string | null;
  signedAdmitters: string[];
  /** Where the delegated WRITE goes — a separate answer; see `chooseExecutor`. */
  executor: RoutableNode | null;
  /** Why no node can execute, when none can. Not an error state. */
  executorReason: string | null;
}> {
  let invitation: { invitation?: { admitters?: string[] } };
  try {
    invitation = JSON.parse(invitationJson) as typeof invitation;
  } catch (cause) {
    throw new Error(
      `That is not valid JSON. Paste the invitation exactly as the node printed it — ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  // Read the admitters from INSIDE the signed body. The envelope also carries
  // `admitter_addrs`, which is a hint the relayer chose and the admin did not
  // sign; trusting that for authorization would let whoever passed the
  // invitation along nominate the node.
  const signedAdmitters = invitation.invitation?.admitters ?? [];

  const cloud = new CloudClient({
    cloudBaseUrl: normaliseUrl(cloudUrl),
    routingCredential: {
      credential: identity.credential,
      deviceSecret: identity.deviceSecret,
    },
  });
  const routing = await cloud.getNamespaceRouting(namespaceId);

  const classified = classifyNodes(routing.nodes, signedAdmitters);
  const { chosen, reason } = chooseAdmitter(classified);
  // Both answers from ONE routing read. The cloud already returned `canExecute`
  // and `relayUrl` per node, so asking twice would cost a second challenge
  // round-trip to learn nothing new.
  const { chosen: executor, reason: executorReason } = chooseExecutor(routing.nodes);
  return { classified, chosen, reason, signedAdmitters, executor, executorReason };
}


/**
 * Claim an invitation: sign the membership op and hand it to an admitter.
 *
 * This is the step that makes the account a MEMBER, and without it the read
 * answers 403 and the write is refused — the demo could resolve a node and then
 * had nothing to be on it.
 *
 * ## The joiner signs; the admitter only carries
 *
 * The op is signed by the device key inside the credential it carries, and
 * every peer checks `signer == credential.sign_pk` when applying it. So the
 * admitter cannot substitute a different account, change the group or grant a
 * role — all of that sits inside a signature it does not hold. What it can do is
 * refuse, which is a liveness problem and not an authority one, and is why an
 * invitation naming several admitters is worth more than one naming a single
 * node.
 *
 * The node adds its own `AdmitterEndorsement` as it relays. That rides the
 * envelope, outside this signature and outside the op's id, which is exactly
 * what lets a keyholder be admissible at all: an endorsement can only be signed
 * by an account the invitation named, and a keyholder is not one.
 *
 * ## Parents are empty, and that is not an oversight
 *
 * A keyholder holds no node, so it has no view of the namespace DAG and cannot
 * name its heads. Empty parents is the only thing it *can* sign, and the direct
 * admission path exists precisely for callers in that position.
 *
 * ## Posted with `fetch`, like the read
 *
 * mero-js has `AdminClient.admitJoin`, but `AdminClient` is built around a node
 * credential this caller does not have. The endpoint takes no authentication —
 * the signature is the authorization — so a plain POST is the honest shape.
 */
export async function sendJoin(
  admitUrl: string,
  identity: DeviceIdentity,
  namespaceId: string,
  invitationJson: string,
): Promise<{ published: boolean }> {
  let invitation: Parameters<typeof signMemberJoinOp>[0]['invitation'];
  try {
    invitation = JSON.parse(invitationJson) as typeof invitation;
  } catch (cause) {
    throw new Error(
      `That is not valid JSON. Paste the invitation exactly as the node printed it — ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  const nonces = createLocalStorageNonceSource(joinNonceStorageKey(identity.devicePublicKey));
  const signedOp = await signMemberJoinOp({
    namespaceId,
    member: identity.accountId,
    invitation,
    credential: identity.credential,
    deviceSecret: identity.deviceSecret,
    nonce: await nonces.next(),
  });

  const response = await fetch(admitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ invitation, signedOp }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(explainAdmitFailure(response.status, text));
  }

  const body = text ? (JSON.parse(text) as { data?: { published?: boolean } }) : {};
  return { published: body.data?.published === true };
}

/**
 * Turn an admit refusal into the thing to go and do about it.
 *
 * Each status here has one dominant cause and they have nothing to do with each
 * other, so a bare "HTTP 403" sends people to the wrong place — most often to
 * the invitation when the real answer is which node they sent it to.
 */
function explainAdmitFailure(status: number, body: string): string {
  const detail = body ? `: ${body}` : '';
  switch (status) {
    case 400:
      return (
        `the node refused the op as malformed (400)${detail}. The signature covers the ` +
        'invitation exactly as sent, so a re-serialised or edited invitation fails here.'
      );
    case 403:
      return (
        `the node refused to carry this join (403)${detail}. Either it is not in the ` +
        'invitation’s signed `admitters` list — being live and listed by the cloud is not ' +
        'the same thing — or the invitation itself was rejected as expired or not the ' +
        'inviter’s to issue.'
      );
    case 409:
      return (
        `that node holds no device of its own, so it cannot endorse anyone (409)${detail}. ` +
        'Pick another admitter.'
      );
    default:
      return `the join was not published (HTTP ${status})${detail}`;
  }
}


/** What proving an account to the cloud actually produced, so it can be shown. */
export interface AccountProofResult {
  /** The account the proof names — re-derived by the cloud from the root key. */
  accountId: string;
  /** The sealed challenge, as the cloud minted it. */
  nonce: string;
  /** When that challenge stops being accepted. */
  expiresAtMs: number;
  /** The signature sent, base64. */
  signature: string;
  /** Whether the cloud then served the routing read to this account. */
  accepted: boolean;
  /** How many nodes it answered with — evidence the read really happened. */
  nodeCount: number;
}

/**
 * Prove this account to the cloud, visibly and on its own.
 *
 * {@link discoverAdmitter} already does this as part of the routing read, but
 * silently — which is the wrong shape for a demo whose entire job is to make
 * the flow inspectable. This performs the same three steps and returns what
 * each one produced, so the panel can show a challenge, a signature and the
 * account the cloud read it as.
 *
 * There is deliberately no "connection" to hold onto afterwards. The cloud
 * issues no session here and the client stores nothing: a challenge is sealed,
 * namespace-bound and expires in about two minutes, and every routing read
 * proves itself afresh. A button labelled "connect" would suggest a durable
 * thing that does not exist — so this one demonstrates rather than connects.
 */
export async function proveAccountToCloud(
  cloudUrl: string,
  namespaceId: string,
  identity: DeviceIdentity,
): Promise<AccountProofResult> {
  const base = normaliseUrl(cloudUrl);
  const credential = {
    credential: identity.credential,
    deviceSecret: identity.deviceSecret,
  };

  // 1. Ask for a challenge. Public and unauthenticated on purpose: the nonce is
  //    sealed and bound to one namespace, so it is not a capability — it is the
  //    thing a capability gets demonstrated against.
  const challenge = await new CloudClient({ cloudBaseUrl: base }).getRoutingChallenge(namespaceId);
  if (challenge.nonce === '') {
    throw new Error(
      'The cloud returned no challenge. That endpoint is public, so this is usually the wrong ' +
        'cloud URL or a manager too old to have it.',
    );
  }

  // 2. Sign it with the DEVICE key — not the root, which this tab no longer
  //    holds. The certificate alone would prove nothing: it travels in the clear
  //    in every device-link op, so only this signature binds us to the device.
  const headers = await routingProofHeaders(challenge, credential);

  // 3. Spend it on the read it exists for, and report what came back. Doing the
  //    real read rather than stopping at the signature is the point: it is the
  //    difference between "we produced a proof" and "the cloud accepted it".
  const routing = await new CloudClient({
    cloudBaseUrl: base,
    routingCredential: credential,
  }).getNamespaceRouting(namespaceId);

  return {
    accountId: identity.accountId,
    nonce: challenge.nonce,
    expiresAtMs: challenge.expiresAtMs,
    signature: headers['X-Calimero-Signature'],
    accepted: true,
    nodeCount: routing.nodes.length,
  };
}


/** What claiming an account with a cloud produced, so the panel can show it. */
export interface AccountClaimResult {
  /**
   * The account this claim names, derived from the root key.
   *
   * Derived on both sides and sent by neither: the account IS the hash of the
   * root public key, so there is no field a caller could state that the
   * signature would then contradict.
   */
  accountId: string;
  /** The root public key that signed, 64 hex. */
  rootPublicKey: string;
  /** The sealed challenge, as the cloud minted it. */
  nonce: string;
  /** When that challenge stops being accepted. */
  expiresAtMs: number;
  /** The root signature, base64. */
  signature: string;
  /**
   * Whether a cloud login owns this account, and so whether a session came back.
   *
   * `false` is a success, not a failure: the claim is recorded either way. See
   * {@link claimAccountWithCloud}.
   */
  linked: boolean;
  /** The MDMA session token, or `''` when the account is not linked. */
  sessionToken: string;
  /** The linked login's email, or `''`. */
  email: string;
  /** The cloud's own words for why no session was issued, when there was none. */
  detail: string;
}

/**
 * Claim this account with a cloud, once, by signing its challenge with the ROOT.
 *
 * This is the one thing on the page a device credential cannot do. Every other
 * proof here is device-signed: the routing read, the login statement, the
 * warrant. All of them rest on a certificate the root issued — and a
 * certificate is *public*, travelling in the clear inside every device-link op,
 * so the strongest thing any of them can say is "a device of account X is
 * asking". Only the root can say "X is mine", and that is what this sends.
 *
 * It is worth doing exactly once. The cloud writes the claim down, and from
 * then on it knows the account behind those later device proofs was claimed by
 * whoever holds its root. Nothing re-proves on every read the way the routing
 * proof does.
 *
 * Two outcomes, both of which are the claim succeeding:
 *
 * - **Linked** — a cloud login owns this account, so a session comes back: the
 *   ordinary MDMA session token, which every cloud route accepts. That is the
 *   "talk to the cloud just by holding the key" half.
 * - **Not linked** — the claim is recorded and the session is refused. The
 *   proof establishes *who*; the link establishes *what you are entitled to*.
 *   Anyone can mint a root offline, so a session on the proof alone would
 *   authenticate perfectly and authorize nothing — no plan, no namespaces to
 *   scope it to. Reported rather than thrown, because a keyholder who links
 *   later does not have to come back and prove again.
 *
 * A bad signature or a spent challenge is also a 403, and *is* thrown: nothing
 * was recorded, and the remedy is different.
 */
export async function claimAccountWithCloud(
  cloudUrl: string,
  rootSecret: string,
): Promise<AccountClaimResult> {
  const cloud = new CloudClient({ cloudBaseUrl: normaliseUrl(cloudUrl) });

  // The split halves rather than `signInWithAccount`, for the same reason the
  // routing panel spells its three steps out: the demo exists to show the
  // challenge, the signature and what each produced. A product with the root
  // outside the browser uses these two for a better reason — the secret never
  // reaches this process at all.
  const challenge = await cloud.getAccountLoginChallenge();
  const { publicKey, accountId } = await accountRootFromSecret(rootSecret);
  const signature = await signAccountLogin({ rootSecret, nonce: challenge.nonce });

  const proof = { rootPublicKey: publicKey, nonce: challenge.nonce, signature };
  const base = {
    accountId,
    rootPublicKey: publicKey,
    nonce: challenge.nonce,
    expiresAtMs: challenge.expiresAtMs,
    signature,
  };

  try {
    const session = await cloud.submitAccountLogin(proof);
    return {
      ...base,
      linked: true,
      sessionToken: session.sessionToken,
      email: session.user.email,
      detail: '',
    };
  } catch (error) {
    // Distinguishing the two 403s by the cloud's own wording rather than by a
    // second request. The alternative is asking the cloud whether the claim
    // landed, which needs a session — the thing we were just refused.
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof HTTPError && error.status === 403 && /not linked to a cloud login/i.test(detail)) {
      return { ...base, linked: false, sessionToken: '', email: '', detail };
    }
    throw error;
  }
}

/** Where the demo stores the portal URL it is mid-round-trip with. */
export interface PendingLink {
  /** The cloud the person was sent to. */
  cloudUrl: string;
  /** The account consent was asked for — checked against what comes back. */
  accountId: string;
}

/**
 * Send the person to the cloud to authorise linking this account.
 *
 * Opens a tab rather than navigating, so an unfinished consent leaves the demo
 * exactly as it was — the person can close the tab and nothing has changed. The
 * callback is this page's own URL, so coming back is a reload rather than a
 * route this app would otherwise have no reason to own.
 *
 * Returns what to remember while they are away. It is stored because the answer
 * arrives on a *fresh page load*: the app that asked is gone by then, and only
 * `localStorage` crosses that gap.
 */
export function startCloudLink(
  cloudUrl: string,
  portalUrl: string,
  identity: DeviceIdentity,
): PendingLink {
  // Come back to this page, minus any fragment it is already carrying: a second
  // round trip would otherwise append its answer to the first one's, and the
  // callback reader would take whichever came first.
  const here = new URL(window.location.href);
  here.hash = '';

  const { url } = CloudClient.accountLinkHandoff({
    portalUrl: normaliseUrl(portalUrl),
    accountId: identity.accountId,
    callbackUrl: here.toString(),
  });
  window.open(url, '_blank', 'noopener');
  return { cloudUrl: normaliseUrl(cloudUrl), accountId: identity.accountId };
}

/** What came back from the cloud, once the grant has been spent. */
export interface LinkResult {
  accountId: string;
  /** True when this account was already linked to that login. */
  alreadyLinked: boolean;
}

/**
 * Finish a link the person authorised: spend the grant with the account root.
 *
 * The grant is consent from a cloud login; the signature proves this app holds
 * the account's root. The cloud needs both, which is what made the grant safe to
 * send back through a browser in the first place.
 *
 * Refuses a grant for an account this tab does not hold, rather than trying it:
 * the cloud would refuse it anyway (it re-derives the account from the signing
 * key) but failing here says which of the two accounts is wrong, and a mismatch
 * means the identity changed mid-round-trip.
 */
export async function finishCloudLink(
  pending: PendingLink,
  grant: string,
  identity: DeviceIdentity,
): Promise<LinkResult> {
  if (!identity.rootSecret) {
    throw new Error('This identity has no stored account root, so it cannot sign the grant.');
  }
  if (pending.accountId !== identity.accountId) {
    throw new Error(
      'The account this tab holds is not the one the cloud was asked about. ' +
        'Start the connection again.',
    );
  }
  const link = await new CloudClient({ cloudBaseUrl: pending.cloudUrl }).linkAccountWithGrant({
    grant,
    rootSecret: identity.rootSecret,
  });
  return { accountId: link.accountId, alreadyLinked: link.alreadyLinked };
}

/**
 * Spend an account session on a cloud read, to show it is a real session.
 *
 * `/api/cloud/me/namespaces` is the plainest thing a signed-in caller can ask
 * for, and it is scoped to the linked login — so a non-empty answer is the
 * claim this page makes, demonstrated: the tab is talking to the cloud as the
 * account, holding nothing but a key it proved.
 */
export async function cloudNamespacesForSession(
  cloudUrl: string,
  sessionToken: string,
): Promise<string[]> {
  const cloud = new CloudClient({ cloudBaseUrl: normaliseUrl(cloudUrl), sessionToken });
  return (await cloud.getMyNamespaces()).map((ns) => ns.namespaceId);
}
