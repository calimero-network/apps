// Account (delegated) login: enrol a device with the player's Calimero account
// at the wallet, come back with its certificate, find the relay the cloud
// assigns the account, and keep all of that where mero-js reads it.
//
// This is the vanilla-TS copy of mero-react's `useAccountEnrolment`, in the
// same ORDER of operations: device keys → wallet redirect → callback →
// `completeDeviceEnrolment` → `saveDelegatedCredential` → cloud relays →
// `saveDelegatedSession`. The relay's node key is learned later, by the
// transport, the first time the session is used (see accountTransport.ts).

import {
  CloudClient,
  completeDeviceEnrolment,
  deviceEnrolmentUrl,
  readEnrolmentCallback,
  saveDelegatedCredential,
  saveDelegatedSession,
  type CloudAccountRelay,
  type DelegatedAccountSession,
} from "@calimero-network/mero-js";

/** The hosted wallet's enrolment page (the one `useAccountEnrolment` uses). */
export const WALLET_URL = "https://wallet.cloud.calimero.network/account-enroll";
/** Same keys as mero-react, so a device enrolled by either is one device. */
const DEVICE_KEY = "calimero.device";
const STATE_KEY = "calimero.enrol.state";

const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

interface DeviceKeys {
  signPk: string;
  signSk: string;
  kemPk: string;
  kemSk: string;
}

/**
 * This browser's device key pair (signing + delivery), generated once and kept
 * in localStorage: the wallet certifies the public halves, and the private
 * halves are what the session signs with afterwards.
 */
export async function deviceKeys(): Promise<DeviceKeys> {
  const had = localStorage.getItem(DEVICE_KEY);
  if (had) {
    try {
      const parsed = JSON.parse(had) as Partial<DeviceKeys>;
      if (parsed.kemSk && parsed.signSk && parsed.signPk && parsed.kemPk) return parsed as DeviceKeys;
    } catch {
      /* unreadable — regenerate below */
    }
    localStorage.removeItem(DEVICE_KEY);
  }
  const sign = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  let agree: CryptoKeyPair;
  try {
    agree = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  } catch {
    throw new Error(
      "this browser cannot generate an X25519 key, so it cannot receive wrapped scope keys. " +
        "Chrome 133+ and Safari 17+ support it.",
    );
  }
  const keys: DeviceKeys = {
    signPk: hex(await crypto.subtle.exportKey("raw", sign.publicKey)),
    signSk: hex((await crypto.subtle.exportKey("pkcs8", sign.privateKey)).slice(16)),
    kemPk: hex(await crypto.subtle.exportKey("raw", agree.publicKey)),
    kemSk: hex((await crypto.subtle.exportKey("pkcs8", agree.privateKey)).slice(16)),
  };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(keys));
  return keys;
}

/** Does the URL carry the wallet's answer (a credential, or a refusal)? */
export function isReturningFromWallet(location: { hash: string } = window.location): boolean {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (params.get("error")) return true;
  return Boolean(params.get("credential") && params.get("account") && params.get("device"));
}

/**
 * Leave for the wallet to approve this device. `navigate` is injectable for
 * tests; the default is a real redirect, and nothing after it runs.
 */
export async function beginAccountEnrolment(
  navigate: (url: string) => void = (url) => window.location.assign(url),
  walletUrl: string = WALLET_URL,
): Promise<void> {
  const keys = await deviceKeys();
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    /* the comparison on return is the gate; without storage it fails closed */
  }
  navigate(
    deviceEnrolmentUrl({
      walletUrl,
      devicePublicKey: keys.signPk,
      kemPublicKey: keys.kemPk,
      returnTo: window.location.origin + window.location.pathname,
      state,
    }),
  );
}

export interface ChosenRelay {
  relayUrl: string | null;
  executorAccount: string | null;
  /** what to tell the player when there is nowhere to write (yet) */
  note: string | null;
}

function executorOf(relay: CloudAccountRelay): string | null {
  const value = (relay as { executorAccount?: unknown }).executorAccount;
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/** Which of the account's relays to play through: a fresh one, else any with an address. */
export function chooseRelay(relays: readonly CloudAccountRelay[]): ChosenRelay {
  const reachable = relays.filter(
    (r): r is CloudAccountRelay & { relayUrl: string } => typeof r.relayUrl === "string" && r.relayUrl.length > 0,
  );
  const fresh = reachable.find((r) => r.fresh);
  if (fresh) return { relayUrl: fresh.relayUrl, executorAccount: executorOf(fresh), note: null };
  if (reachable.length > 0) {
    return {
      relayUrl: reachable[0].relayUrl,
      executorAccount: executorOf(reachable[0]),
      note: "Connected through a relay whose last heartbeat has lapsed — it may not answer.",
    };
  }
  if (relays.length > 0) {
    return {
      relayUrl: null,
      executorAccount: null,
      note:
        `Signed in. Your account has ${relays.length} relay${relays.length === 1 ? "" : "s"} assigned, ` +
        "but the cloud knows no address for any of them yet. Try again shortly.",
    };
  }
  return {
    relayUrl: null,
    executorAccount: null,
    note:
      "Signed in, with nowhere to play from yet: a new account is a member of nothing. " +
      "Join a friend's world with an invite — that gives your account its relay.",
  };
}

export interface EnrolmentOutcome {
  session: DelegatedAccountSession;
  note: string | null;
}

/**
 * Finish the enrolment the wallet sent us back from. Returns `null` when the
 * URL carries no callback; throws when the wallet refused, the state does not
 * match, or the credential does not certify this browser's device key.
 */
export async function completeAccountEnrolment(deps: { cloudBaseUrl?: string } = {}): Promise<EnrolmentOutcome | null> {
  const back = readEnrolmentCallback(); // throws on `error=`; strips the fragment
  if (!back) return null;
  const keys = await deviceKeys();
  let sent: string | null = null;
  try {
    sent = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* single-use where storage allows it */
  }
  if (!sent) {
    throw new Error(
      'This enrolment could not be verified as one this tab started, so it was not accepted. Start again from "Enrol with your account".',
    );
  }
  const enrolled = await completeDeviceEnrolment({
    ...back,
    devicePublicKey: keys.signPk,
    kemPublicKey: keys.kemPk,
    expectState: sent,
  });
  // Kept as a credential too, so the identity outlives the connection: a
  // relay can be lost without the certificate being lost.
  saveDelegatedCredential({ account: enrolled.account, credential: enrolled.credential, deviceSecret: keys.signSk });

  const cloud = new CloudClient({
    cloudBaseUrl: deps.cloudBaseUrl,
    routingCredential: { credential: enrolled.credential, deviceSecret: keys.signSk },
  });
  const chosen = chooseRelay(await cloud.getAccountRelays(enrolled.account));
  const session: DelegatedAccountSession = {
    account: enrolled.account,
    credential: enrolled.credential,
    deviceSecret: keys.signSk,
    relayUrl: chosen.relayUrl,
    ...(chosen.executorAccount ? { executorAccount: chosen.executorAccount } : {}),
  };
  saveDelegatedSession(session);
  return { session, note: chosen.note };
}
