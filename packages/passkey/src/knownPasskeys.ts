/**
 * The passkeys this browser has seen work on a cluster, offered alone at the
 * next sign-in.
 *
 * Every Calimero cluster shares one passkey domain (`calimero.network`), so a
 * sign-in prompt with no list offers every Calimero passkey the person has:
 * another cluster's, an earlier cluster that had this one's name, any app's.
 * The node refuses all but this cluster's (`PASSKEY_UNKNOWN_HERE`), and they
 * look alike. A sign-in cannot ask the node for the account's list before it
 * knows the account, so the page keeps the ids that worked here and asks the
 * browser for those. A prompt that fails with the list forgets it, so the next
 * try offers every passkey again (a passkey removed elsewhere, a new device).
 * A step-up's own list (the node's, `allowCredentials`) is used as given.
 */
import type { PasskeyProvider } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

const MAX_KEPT = 16;

function read(storage: KeyValueStorage | undefined, key: string): string[] {
  try {
    const ids: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && x !== "") : [];
  } catch {
    return [];
  }
}

function write(storage: KeyValueStorage | undefined, key: string, ids: string[]): void {
  try {
    if (ids.length) storage?.setItem(key, JSON.stringify(ids.slice(0, MAX_KEPT)));
    else storage?.removeItem?.(key);
  } catch {
    // Site data blocked: the next sign-in offers every passkey, as before.
  }
}

/** The credential ids kept under `key`, newest first. */
export function knownPasskeys(key: string, storage?: KeyValueStorage): string[] {
  return read(storage, key);
}

/** `passkey` offering only the passkeys kept under `key` at a sign-in, and keeping every one that works. */
export function thisClusterPasskey(passkey: PasskeyProvider, key: string, storage?: KeyValueStorage): PasskeyProvider {
  return {
    ...passkey,
    create: (options) => passkey.create(options),
    get: async (challenge, rpId, allowCredentials, options) => {
      const given = allowCredentials?.length ? allowCredentials : null;
      const known = given ? [] : read(storage, key);
      try {
        const assertion = await passkey.get(challenge, rpId, given ?? (known.length ? known : undefined), options);
        if (assertion.credentialId) {
          write(storage, key, [assertion.credentialId, ...read(storage, key).filter((x) => x !== assertion.credentialId)]);
        }
        return assertion;
      } catch (e) {
        if (known.length) write(storage, key, []);
        throw e;
      }
    },
  };
}
