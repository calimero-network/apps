import {
  generateAccountRoot,
  mintDeviceId,
  signDeviceCert,
  signerFromSecret,
  verifyDeviceCredential,
} from "@calimero-network/mero-js";
import nacl from "tweetnacl";

/**
 * A website form's key: an account of its own, with one certified device.
 *
 * The website's backend holds `deviceSecret` and signs a warrant for each
 * response; a relay runs `submit_response` as `account` (delegated execution).
 * See the README, "Form keys".
 *
 * Minted entirely in this tab and never sent anywhere but to the admin who
 * copies it. Two secrets a full account would keep are thrown away on
 * purpose, because a form never needs them:
 *
 * - the account ROOT, which certifies new devices. Rotating a form key means
 *   minting a new one, never re-certifying this one, so the root has no use
 *   after the one certificate below and nobody should be able to steal it.
 * - the device's key-delivery (X25519) secret, which group keys are delivered
 *   to. The form never decrypts state: the relay runs the method inside its
 *   TEE. Without this secret the key can sign a response and read nothing, even
 *   if every value on the website's server leaks.
 */
export interface FormIdentity {
  /** The account, 64 hex: what joins the namespace and what responses are stamped with. */
  account: string;
  /** Its `AccountProof<DeviceCert>`, hex: proves the device belongs to the account. */
  credential: string;
  /** The device's ed25519 signing secret, hex. The one real secret. */
  deviceSecret: string;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function mintFormIdentity(): Promise<FormIdentity> {
  const root = await generateAccountRoot();

  const deviceSecret = hex(crypto.getRandomValues(new Uint8Array(32)));
  const signPublicKey = (await signerFromSecret(deviceSecret)).publicKey;
  const kemPublicKey = hex(nacl.box.keyPair().publicKey);

  const device = await mintDeviceId(root.accountId, crypto.getRandomValues(new Uint8Array(16)));
  const credential = await signDeviceCert({
    rootSecret: root.secret,
    device,
    signPublicKey,
    kemPublicKey,
    deviceEpoch: 1,
  });

  const checked = await verifyDeviceCredential(credential);
  if (checked.account !== root.accountId) {
    throw new Error("the device certificate does not name the account it was minted for");
  }
  return { account: root.accountId, credential, deviceSecret };
}

/**
 * The environment variables the website's backend reads, as one block to
 * paste. Names match `api/contact.ts` in calimero-network/landing.
 */
export function envBlock(identity: FormIdentity, contextId: string, formId: string): string {
  return [
    `CALIMERO_CONTEXT_ID=${contextId}`,
    `CALIMERO_FORM_ID=${formId}`,
    `CALIMERO_FORM_ACCOUNT=${identity.account}`,
    `CALIMERO_FORM_CREDENTIAL=${identity.credential}`,
    `CALIMERO_FORM_DEVICE_SECRET=${identity.deviceSecret}`,
  ].join("\n");
}
