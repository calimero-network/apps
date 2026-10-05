// Account (Cloud) sign-in: the vanilla-TS port of mero-react's
// `useAccountEnrolment`, same order of operations, no React.
//
//   goToWallet()            — generate (or reuse) this browser's device keys,
//                             remember a state parameter, leave for the wallet.
//   completeEnrolment()     — on the way back: read the callback ONCE, check
//                             the state against the one sent, verify the
//                             certificate, save the credential, ask the cloud
//                             which relay serves the account, adopt the session.
//
// The credential + relay are mero-js's delegated session (per tab); the device
// keys live in localStorage so they survive the redirect — a key regenerated
// on the way home would not match the certificate the wallet just minted.
// Every call after this goes through transport.ts as an account.

import {
  CloudClient,
  completeDeviceEnrolment,
  deviceEnrolmentUrl,
  readEnrolmentCallback,
  saveDelegatedCredential,
  saveDelegatedSession,
  type CloudAccountRelay,
  type DeviceEnrolmentCallback,
} from "@calimero-network/mero-js";
import { adoptAccountSession } from "./session";
import { resetTransport } from "./transport";

/** Where this browser's device keypair lives. */
const DEVICE_KEY = "calimero.device";
/** The state parameter this tab sent to the wallet, to check what comes back. */
const STATE_KEY = "calimero.enrol.state";

/**
 * The hosted wallet, which is a property of the platform rather than of any
 * app: every app that enrols an account enrols it at the same wallet.
 */
export const HOSTED_WALLET = "https://wallet.cloud.calimero.network/account-enroll";

const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

interface DeviceKeys {
  /** Ed25519 public key — what the certificate names, and what signs. */
  signPk: string;
  /** Ed25519 secret, hex seed. Signs warrants and the login statement. */
  signSk: string;
  /** X25519 public key — where wrapped scope keys are delivered. */
  kemPk: string;
  /** X25519 secret. Without it, anything delivered to `kemPk` is unreadable. */
  kemSk: string;
}

/**
 * This browser's device keys, generated once. TWO keypairs, for two jobs the
 * `DeviceCert` names separately: an Ed25519 pair that signs, and an X25519
 * pair that receives. Both halves of both are kept.
 */
async function deviceKeys(): Promise<DeviceKeys> {
  const had = localStorage.getItem(DEVICE_KEY);
  if (had) {
    try {
      const parsed = JSON.parse(had) as Partial<DeviceKeys>;
      if (parsed.kemSk && parsed.signSk && parsed.signPk && parsed.kemPk) return parsed as DeviceKeys;
    } catch {
      /* corrupt — regenerate below */
    }
    // keys without an agreement secret cannot receive a wrapped scope key,
    // ever — re-enrolling the device is cheap, keeping them is not
    localStorage.removeItem(DEVICE_KEY);
  }

  const sign = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  let agree: CryptoKeyPair;
  try {
    agree = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  } catch {
    throw new Error(
      "this browser cannot generate an X25519 key, so it cannot receive wrapped " +
        "scope keys. Chrome 133+ and Safari 17+ support it; enrolling without one " +
        "would certify a delivery key nothing holds the secret for.",
    );
  }
  // pkcs8 wraps the 32-byte seed behind a 16-byte header, for both curves.
  const keys: DeviceKeys = {
    signPk: hex(await crypto.subtle.exportKey("raw", sign.publicKey)),
    signSk: hex((await crypto.subtle.exportKey("pkcs8", sign.privateKey)).slice(16)),
    kemPk: hex(await crypto.subtle.exportKey("raw", agree.publicKey)),
    kemSk: hex((await crypto.subtle.exportKey("pkcs8", agree.privateKey)).slice(16)),
  };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(keys));
  return keys;
}

/**
 * Whether this page load is the one coming back from the wallet — a completed
 * enrolment or a declined one — WITHOUT consuming it. The launcher uses it to
 * open the connect popup on the Cloud tab before anything is read.
 */
export function isReturningFromWallet(location: { hash: string } = window.location): boolean {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (params.get("error")) return true;
  return Boolean(params.get("credential") && params.get("account") && params.get("device"));
}

/** Leave for the wallet to enrol this browser's device key. Does not return. */
export async function goToWallet(walletUrl: string = HOSTED_WALLET): Promise<void> {
  const keys = await deviceKeys();
  // Remembered before leaving, so what comes back can be checked against what
  // we sent. Without this the state parameter is decoration.
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    /* storage unavailable: the check on return reports it as unverifiable */
  }
  window.location.assign(
    deviceEnrolmentUrl({
      walletUrl,
      devicePublicKey: keys.signPk,
      kemPublicKey: keys.kemPk,
      returnTo: window.location.origin + window.location.pathname,
      state,
    }),
  );
}

/**
 * Which of the account's relays to talk to, and what to say about it (the
 * mero-react rule). The session is adopted in EVERY case — a relay-less
 * account is signed in with nowhere to write yet, and being signed in is how
 * it comes to be invited: redeeming an invitation is what earns it a relay.
 */
export function chooseRelay(relays: readonly CloudAccountRelay[]): {
  relayUrl: string | null;
  executorAccount: string | null;
  note: string | null;
} {
  const executorOf = (r: CloudAccountRelay): string | null =>
    typeof r.executorAccount === "string" && /^[0-9a-f]{64}$/.test(r.executorAccount) ? r.executorAccount : null;
  const reachable = relays.filter(
    (r): r is CloudAccountRelay & { relayUrl: string } => typeof r.relayUrl === "string" && r.relayUrl.length > 0,
  );
  const fresh = reachable.find((r) => r.fresh);
  if (fresh) return { relayUrl: fresh.relayUrl, executorAccount: executorOf(fresh), note: null };
  if (reachable.length > 0) {
    return {
      relayUrl: reachable[0].relayUrl,
      executorAccount: executorOf(reachable[0]),
      note:
        "Connected through a relay whose last heartbeat has lapsed — it may not answer. " +
        "It was the only one with an address.",
    };
  }
  if (relays.length > 0) {
    return {
      relayUrl: null,
      executorAccount: null,
      note:
        `Signed in. Your account has ${relays.length} relay${relays.length === 1 ? "" : "s"} ` +
        "assigned, but the cloud knows no address for any of them yet, so there is nowhere to " +
        "write through for the moment. Reads and writes resume as soon as one reports in.",
    };
  }
  return {
    relayUrl: null,
    executorAccount: null,
    note:
      "Signed in, with nowhere to write yet: a new account is a member of nothing, so no node " +
      "serves it. Joining a world with an invite admits this account and gives it a relay — " +
      "that is the normal first step, not an error.",
  };
}

export type EnrolmentResult =
  | { status: "none" } // an ordinary page load
  | { status: "enrolled"; account: string; note: string | null }
  | { status: "failed"; note: string };

/**
 * Finish an enrolment we are returning from. Call once at boot, before the
 * launcher renders, so a tab coming back from the wallet lands signed in.
 *
 * `readEnrolmentCallback` strips the fragment, so a reload cannot replay the
 * credential; a declined approval throws there and is reported, not thrown.
 */
export async function completeEnrolment(
  deps: { cloud?: CloudClient; location?: { hash: string } } = {},
): Promise<EnrolmentResult> {
  let back: DeviceEnrolmentCallback | null;
  try {
    back = readEnrolmentCallback(deps.location);
  } catch (e) {
    return { status: "failed", note: e instanceof Error ? e.message : String(e) };
  }
  if (!back) return { status: "none" };

  // The state we sent, not the one that came back: comparing the returned
  // value against itself always passes, and then any page able to drive this
  // origin's callback could have had a credential adopted here.
  let sent: string | null = null;
  try {
    sent = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* single-use where storage allows it; the comparison below is the gate */
  }
  if (!sent) {
    return {
      status: "failed",
      note:
        "This enrolment could not be verified as one this tab started, so it was not " +
        'accepted. Start again from "Enrol with your account".',
    };
  }

  try {
    const keys = await deviceKeys();
    const enrolled = await completeDeviceEnrolment({
      ...back,
      devicePublicKey: keys.signPk,
      kemPublicKey: keys.kemPk,
      expectState: sent,
    });

    // Saved BEFORE the relay lookup, and kept whatever that lookup answers:
    // a first-time account is a member of nothing, so the cloud correctly
    // names no relay — the certificate is still real, and it is what
    // resolves a relay from an INVITATION instead.
    const credential = { account: enrolled.account, credential: enrolled.credential, deviceSecret: keys.signSk };
    saveDelegatedCredential(credential);

    // Where to write: asked, not typed. The certificate is the only input —
    // the cloud mints an account-bound nonce, the device key signs it, and
    // the relay list comes back attributed to this account. No cloud sign-in.
    const cloud =
      deps.cloud ??
      new CloudClient({ routingCredential: { credential: enrolled.credential, deviceSecret: keys.signSk } });
    const chosen = chooseRelay(await cloud.getAccountRelays(enrolled.account));

    // The certificate authenticates reads and the event stream as well as the
    // writes; nothing else to obtain. The relay's executor rides along when
    // the cloud named one, so a brand-new account can found a world's
    // namespace on it with no join first.
    saveDelegatedSession({
      ...credential,
      relayUrl: chosen.relayUrl,
      ...(chosen.executorAccount ? { executorAccount: chosen.executorAccount } : {}),
    });
    adoptAccountSession({ contextId: null, applicationId: null, executorPublicKey: null });
    resetTransport();
    return { status: "enrolled", account: enrolled.account, note: chosen.note };
  } catch (e) {
    return { status: "failed", note: e instanceof Error ? e.message : String(e) };
  }
}

/** short form of an account id for the UI */
export function shortAccount(account: string): string {
  return account.length > 12 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}
