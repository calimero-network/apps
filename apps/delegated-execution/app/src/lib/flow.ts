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
  RelayClient,
  createLocalStorageNonceSource,
  login,
  routingProofHeaders,
  signMemberJoinOp,
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
