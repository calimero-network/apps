import type { KeyValueStorage } from "@calimero-apps/connect";
import { APP_NAME } from "../config";
import { nodeBasename } from "./servedByNode";

/**
 * Team invitations on Calimero 1.0: an **org invite** token (minted with the
 * inviter's passkey, `client.invite`) carried in `?invite=` on a link to this
 * frontend, redeemed (`client.redeemInvite`) once the person is signed in and
 * says yes. Replaces v1's signed namespace invitation in a deflate+base58
 * link, and its desktop deep link.
 */

/** The link that opens this frontend with `token` to redeem. */
export function inviteLink(
  token: string,
  location: Pick<Location, "origin"> = window.location,
  base: string = nodeBasename(),
): string {
  const url = new URL(base, location.origin);
  url.searchParams.set("invite", token);
  return url.toString();
}

export interface PendingInvite {
  token: string;
}

const PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` off the address bar into storage, before anything renders:
 * a person opening a link is usually not signed in yet, and the token must
 * survive the passkey sign-up. Redeemed (and dropped) once a session exists
 * and the person says yes.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(PENDING, JSON.stringify({ token } satisfies PendingInvite));
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === "string" && parsed.token ? { token: parsed.token } : null;
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}
