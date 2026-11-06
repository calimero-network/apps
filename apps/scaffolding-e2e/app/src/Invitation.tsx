import { useEffect, useState } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { describeError, type KeyValueStorage } from "@calimero-apps/connect";
import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import type { SessionApi } from "./session";
import { SPENT_INVITE, dropInvite, isSpentInvite, pendingInviteOrg } from "./instances";

/**
 * The invitation screens. `main.tsx` took `?invite=` (and the `?org=` beside
 * it) into storage before React mounted, so the token survives a sign-up;
 * while it is pending the app shows one of these in place of its usual page.
 */

/**
 * Signed out, with an invitation: the passkey sign-in and sign-up, said as an
 * invitation. "Not now" shows the usual page and keeps the token, so signing
 * in from there still asks to join.
 */
export function InvitationSignIn({ api, where, onLater }: { api: SessionApi; where: string; onLater: () => void }) {
  return (
    <div className="method-card" data-testid="invitation-page">
      <div className="method-name">You&apos;re invited</div>
      <p className="method-hint" style={{ marginBottom: 14 }}>
        You&apos;ve been invited to join a shared instance in the E2E test suite. Sign in or create an account to accept. Connected
        to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div style={{ maxWidth: 360 }}>
        <PasskeySignIn api={api} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-calimero-outline" onClick={onLater} disabled={api.busy} data-testid="invitation-later">
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * Signed in, with an invitation: "Join the shared instance?", asked rather than done,
 * since joining makes you a member of someone else's organization.
 *
 * Redeeming spends one of the invite's uses even for someone already in the
 * org, so a link that names its org is checked against the account's orgs
 * first and a member is told so instead. A spent invitation (used, expired,
 * revoked) is said plainly, not dropped silently.
 */
export function JoinInvitation({
  client,
  token,
  storage,
  after,
  onJoined,
  onClose,
}: {
  client: Pick<CalimeroClient, "me" | "redeemInvite">;
  token: string;
  storage: KeyValueStorage;
  after: () => void;
  /** Redeemed: the shared instance is the account's now. */
  onJoined: () => void;
  /** Nothing (more) to accept: back to the usual page. */
  onClose: () => void;
}) {
  const [checking, setChecking] = useState(() => pendingInviteOrg(storage) !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"member" | "spent" | null>(null);

  useEffect(() => {
    const org = pendingInviteOrg(storage);
    if (!org) return;
    let live = true;
    Promise.resolve()
      .then(() => client.me())
      .then((me) => {
        const orgs = (me as { orgs?: Array<{ orgId: string }> }).orgs ?? [];
        if (!live || !orgs.some((o) => o.orgId === org)) return;
        dropInvite(storage);
        setOutcome("member");
      })
      // Unknown membership: ask, as for a link that names no org.
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [client, storage]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await client.redeemInvite(token);
      dropInvite(storage);
      onJoined();
    } catch (e) {
      if (isSpentInvite(e)) {
        dropInvite(storage);
        setOutcome("spent");
      } else {
        // The cluster unreachable, say: the token is kept to try again.
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      }
    } finally {
      setBusy(false);
      after();
    }
  }

  if (outcome) {
    return (
      <div className="method-card" data-testid="invitation-outcome">
        <div className="method-name">{outcome === "member" ? "You're already in this shared instance" : "This invite cannot be used"}</div>
        <p className="method-hint" style={{ marginBottom: 14 }}>
          {outcome === "member"
            ? "The invitation was for a shared instance you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for."
            : SPENT_INVITE}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-calimero" onClick={onClose} data-testid="invitation-continue">
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="method-card" data-testid="invitation-prompt">
      <div className="method-name">Join the shared instance?</div>
      <p className="method-hint" style={{ marginBottom: 14 }}>
        You were invited to a shared instance in the E2E test suite. Joining makes you a member of its organization, and the 
        shared instance appears in your list.
      </p>
      {error && <pre className="result-box error">{error}</pre>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button" className="btn-calimero"
          onClick={() => void join()}
          disabled={busy || checking}
          data-testid="invitation-join"
        >
          {busy ? "Joining…" : checking ? "Checking…" : error ? "Try again" : "Join"}
        </button>
        <button
          type="button" className="btn-calimero-outline"
          onClick={() => {
            dropInvite(storage);
            onClose();
          }}
          disabled={busy}
          data-testid="invitation-dismiss"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
