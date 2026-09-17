/**
 * What survives a page reload, and what deliberately does not.
 *
 * ## The root secret is not here, on purpose
 *
 * The account root is the account. mero-js says in as many words that in a
 * browser it does not belong in `localStorage`, and this demo agrees: it is
 * held in React state for exactly as long as it takes to certify a device, and
 * then it is gone. The 24-word phrase shown once is the backup, which is the
 * point of having a phrase at all.
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
    if (devicePublicKey) {
      localStorage.removeItem(nonceStorageKey(devicePublicKey));
    }
  } catch {
    // Nothing was persisted; nothing to forget.
  }
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
