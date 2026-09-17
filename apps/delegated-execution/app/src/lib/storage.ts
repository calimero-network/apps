/**
 * What survives a page reload, and what deliberately does not.
 *
 * ## The root secret IS here, and it is the one compromise on this page
 *
 * The account root is the account, and mero-js says in as many words that in a
 * browser it does not belong in `localStorage`. This demo keeps it anyway,
 * inside the identity blob, because claiming an account with the cloud is a
 * *root* signature: without a stored root the button could be pressed exactly
 * once, before the first reload, and never again without re-entering 24 words.
 *
 * The trade is real and worth stating rather than hiding. A stolen device key
 * is revocable — that is what device certificates are for — and a stolen root
 * is the account, permanently. A product keeps the root in a desktop app, a
 * hardware key or an OS keychain and signs the challenge there; mero-js splits
 * `signAccountLogin` out from `signInWithAccount` precisely so it can. The
 * 24-word phrase shown once is still the backup.
 *
 * ## The claim is here too, because it is the thing that persists
 *
 * A routing proof is re-made on every read and nothing survives it. The
 * ownership claim is the opposite: it is proved once, the cloud records it, and
 * what this app stores is the receipt — which account was claimed, against
 * which cloud, and the session that came back. See {@link AccountClaim}.
 *
 * ## The device secret is here, also on purpose
 *
 * A device key is the thing a device holds — persisting it is what "reload the
 * page and you are still you" means, and it is the same trust boundary a native
 * app's keychain entry sits on. It is scoped to the origin, and revoking the
 * device is what recovers from losing the machine. A demo that re-minted a
 * device on every reload would be hiding the part worth showing: that a session
 * comes from a key you already had, not from a login you just performed.
 *
 * ## Nonces live next door
 *
 * mero-js's `createLocalStorageNonceSource` takes the key from its caller, so
 * {@link nonceStorageKey} is this app's choice and not an upstream constant.
 * Keying it by the device's public key is the part that matters: a counter
 * shared between two devices hands the same number to both, and the second
 * warrant is refused as a replay. Wiping the identity must wipe the counter
 * with it, which is what {@link clearStored} does — a surviving counter under a
 * regenerated device is the one combination that produces warrants the network
 * has already seen.
 */

import type { DeviceIdentity } from './identity.js';

const IDENTITY_KEY = 'calimero.delegated-demo.identity';
const SETTINGS_KEY = 'calimero.delegated-demo.settings';
const CLAIM_KEY = 'calimero.delegated-demo.account-claim';

/** Where this tab is pointed, and at what. */
export interface Settings {
  /**
   * The cloud manager's base URL.
   *
   * Routing comes from here rather than from a typed-in node address: the cloud
   * knows which nodes serve a namespace, whether their heartbeats are fresh, and
   * whether each holds `CAN_AUTHOR_ON_BEHALF` — none of which a pasted URL can
   * say, and all of which decide whether a write will be taken.
   */
  cloudUrl: string;
  /** The namespace the invitation is for, 64 hex. */
  namespaceId: string;
  /**
   * The invitation as the operator's node issued it, verbatim JSON.
   *
   * The signed body carries the `admitters` list, which is authorization: a node
   * outside it refuses the claim. Everything beside the signature is a hint.
   */
  invitationJson: string;
  /**
   * The node's device signing key, 64 hex — **still pinned out of band**.
   *
   * The one field discovery cannot supply. It is the `node` binding inside the
   * login statement, and a node that told you its own key could decide what you
   * signed about. Neither the invitation nor the cloud carries it, and the cloud
   * serving a node-*reported* value would move the trust-on-first-use one hop
   * rather than remove it — closing this needs the key inside the attestation
   * quote's binding, which is tracked separately.
   */
  nodeKey: string;
  /** The context to read and write, 64 hex. */
  contextId: string;
  /**
   * The node the delegated WRITE is posted to — resolved from the cloud, and
   * deliberately NOT the same field as {@link Settings.nodeUrl}.
   *
   * Admission and authorship are different permissions held by different nodes:
   * the invitation's signed `admitters` decides who may relay a join,
   * `CAN_AUTHOR_ON_BEHALF` decides who may write on your behalf, and one node
   * can hold either without the other. The two legs are independent anyway —
   * the intent carries a warrant, not the session token — so nothing requires
   * them to be the same node.
   */
  relayUrl: string;
  /**
   * Where a signed join is posted — the cloud's ready-made `admitUrl` for the
   * chosen admitter.
   *
   * Stored rather than rebuilt from {@link Settings.nodeUrl}: the cloud hands
   * this over complete so a caller never has to know the path, and a client
   * that reassembles it is one core route rename away from a 404 that reads
   * like a refusal.
   */
  admitUrl: string;
  /** Resolved by discovery, not typed: the chosen admitter's base URL. */
  nodeUrl: string;
}

export const EMPTY_SETTINGS: Settings = {
  cloudUrl: '',
  namespaceId: '',
  invitationJson: '',
  nodeKey: '',
  contextId: '',
  nodeUrl: '',
  relayUrl: '',
  admitUrl: '',
};

/** Read JSON from `localStorage`, treating any failure as absence. */
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    // A private window, blocked site data, or a value written by an older
    // shape. All three mean "start fresh" rather than "fail", and a demo that
    // threw here would be unusable in exactly the browser mode people reach for
    // when trying something with keys in it.
    return null;
  }
}

/** Write JSON, treating a failure as "this browser does not persist" rather than an error. */
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota, or a private window that refuses writes. The session in memory
    // still works; only the reload does not.
  }
}

export function loadIdentity(): DeviceIdentity | null {
  const stored = read<DeviceIdentity>(IDENTITY_KEY);
  if (!stored) return null;
  // Written by this app, but not necessarily by this *version* of it. A shape
  // check here turns "an old identity is silently half-loaded and every
  // signature is refused" into "no identity, mint one".
  const complete =
    typeof stored.accountId === 'string' &&
    typeof stored.deviceId === 'string' &&
    typeof stored.deviceSecret === 'string' &&
    typeof stored.devicePublicKey === 'string' &&
    typeof stored.credential === 'string';
  return complete ? stored : null;
}

export function saveIdentity(identity: DeviceIdentity): void {
  write(IDENTITY_KEY, identity);
}

export function loadSettings(): Settings {
  const stored = read<Partial<Settings>>(SETTINGS_KEY);
  // Spread the defaults rather than naming each field: a blob written before a
  // field existed must load it as `''` and not `undefined`, or React renders an
  // uncontrolled input and warns on the first keystroke. Listing the fields by
  // hand meant every new setting needed a matching line here, and forgetting one
  // showed up only as that warning.
  const merged: Settings = { ...EMPTY_SETTINGS };
  for (const key of Object.keys(EMPTY_SETTINGS) as (keyof Settings)[]) {
    const value = stored?.[key];
    if (typeof value === 'string') merged[key] = value;
  }
  return merged;
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

/**
 * Forget the identity, and the nonce counter that belongs to it.
 *
 * Both, or neither. Clearing the identity alone leaves a counter that the next
 * device would not read (it is keyed by public key) but that would resume if
 * the same device were ever restored — and clearing the counter alone replays
 * from 1 under a device the network has already seen numbers from. The
 * device's public key is therefore required rather than optional-by-default;
 * `null` means "there was no identity", not "skip the counter".
 */
export function clearStored(devicePublicKey: string | null): void {
  try {
    localStorage.removeItem(IDENTITY_KEY);
    // The claim names an account this browser can no longer prove anything
    // about, and a receipt outliving its key reads as "still connected" on a
    // page that now holds nothing.
    localStorage.removeItem(CLAIM_KEY);
    if (devicePublicKey) {
      localStorage.removeItem(nonceStorageKey(devicePublicKey));
      localStorage.removeItem(joinNonceStorageKey(devicePublicKey));
    }
  } catch {
    // Nothing was persisted; nothing to forget.
  }
}

/**
 * The receipt from claiming this account with a cloud.
 *
 * Stored because the claim is durable in a way nothing else on this page is: a
 * routing proof is namespace-bound and expires in two minutes, a session token
 * expires in a week, but *"the root of this account proved it owns it"* is a
 * fact the cloud has written down and will not ask about again. The receipt is
 * what lets the page say so after a reload instead of offering the button as
 * though nothing had happened.
 *
 * `sessionToken` is empty when the cloud refused a session — which it does for
 * an account no cloud login has linked. That refusal is not a failed claim: the
 * proof established WHO, the link establishes what they are entitled to, and
 * the cloud records the first regardless. {@link AccountClaim.linked} is the
 * field that separates the two, so the panel can report an unlinked account as
 * proven rather than as broken.
 */
export interface AccountClaim {
  /** The account the cloud derived from the root key that signed. */
  accountId: string;
  /** Which cloud recorded it. A claim is not portable between managers. */
  cloudUrl: string;
  /** When this tab made the claim, epoch ms. */
  provenAt: number;
  /** Whether a cloud login owns this account, and so whether a session came back. */
  linked: boolean;
  /** The MDMA session token, or `''` when the account is not linked. */
  sessionToken: string;
  /** The linked login's email, or `''`. */
  email: string;
}

export function loadClaim(): AccountClaim | null {
  const stored = read<AccountClaim>(CLAIM_KEY);
  if (!stored) return null;
  // Same shape check as the identity, for the same reason: a half-read receipt
  // would render a panel claiming a proof that may never have happened.
  return typeof stored.accountId === 'string' && typeof stored.cloudUrl === 'string'
    ? stored
    : null;
}

export function saveClaim(claim: AccountClaim): void {
  write(CLAIM_KEY, claim);
}

/**
 * The `localStorage` key this app keeps a device's warrant counter under.
 *
 * Exported so the one spelling is shared by the code that creates the source
 * and the code that clears it. Two literals here is how a counter outlives the
 * identity it belonged to.
 */
export function nonceStorageKey(devicePublicKey: string): string {
  return `calimero.warrant.nonce.${devicePublicKey}`;
}

/**
 * The counter for governance ops this device signs — separate from the warrant
 * counter above, and deliberately so.
 *
 * The two are different anti-replay windows kept by different code for
 * different things: a warrant's nonce is spent against a relay on apply, a
 * namespace op's is checked by every peer that folds the op. Sharing one
 * counter would make each spend a number the other then skips, which reads as
 * a gap in a sequence that is supposed to be dense.
 */
export function joinNonceStorageKey(devicePublicKey: string): string {
  return `calimero.namespace-op.nonce.${devicePublicKey}`;
}
