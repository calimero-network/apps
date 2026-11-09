import { useEffect, useState } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { describeError, type KeyValueStorage } from "@calimero-apps/connect";
import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import type { SessionApi } from "./session";
import { SPENT_INVITE, dropInvite, isSpentInvite, pendingInviteOrg } from "./teams";

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
    <div className="card" data-testid="invitation-page">
      <h2>You&apos;re invited</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        You&apos;ve been invited to join a team in Mero Standup. Sign in or create an account to accept. Connected
        to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div style={{ maxWidth: 360 }}>
        <PasskeySignIn api={api} />
      </div>
      <div className="row">
        <button type="button" className="ghost" onClick={onLater} disabled={api.busy} data-testid="invitation-later">
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * Signed in, with an invitation: "Join the team?", asked rather than done,
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
  /** Redeemed: the team is the account's now. */
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
      <div className="card" data-testid="invitation-outcome">
        <h2>{outcome === "member" ? "You're already in this team" : "This invite cannot be used"}</h2>
        <p className="empty" style={{ marginBottom: 14 }}>
          {outcome === "member"
            ? "The invitation was for a team you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for."
            : SPENT_INVITE}
        </p>
        <div className="row">
          <button type="button" onClick={onClose} data-testid="invitation-continue">
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="invitation-prompt">
      <h2>Join the team?</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        You were invited to a team in Mero Standup. Joining makes you a member of its organization, and the 
        team appears in your list.
      </p>
      {error && <pre className="err">{error}</pre>}
      <div className="row">
        <button
          type="button"
          onClick={() => void join()}
          disabled={busy || checking}
          data-testid="invitation-join"
        >
          {busy ? "Joining…" : checking ? "Checking…" : error ? "Try again" : "Join"}
        </button>
        <button
          type="button" className="ghost"
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
