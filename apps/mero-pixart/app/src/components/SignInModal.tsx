import { useEffect } from "react";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { LISTING, describeTarget } from "../api/session";
import { useSessionApi } from "../api/sessionContext";
import { pendingInvite } from "../api/teams";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * node connect dialog (local node discovery, a node URL, the Cloud wallet): on
 * Calimero 1.0 the frontend already knows its cluster (local nodes in dev, the
 * Cloud cluster in production) and the account is a passkey.
 */
export default function SignInModal({ onClose }: { onClose: () => void }) {
  const { api } = useSessionApi();
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (api.session.status === "signed-in") onClose();
  }, [api.session.status, onClose]);

  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <div className="mp-overlay" data-testid="signin-modal" onClick={() => !api.busy && onClose()}>
      <div className="mp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{invited ? "You're invited" : "Sign in"}</h2>
        <p className="sub">
          {invited ? "Sign in, or create an account, to join the team you were invited to. " : ""}
          Accounts are passkeys: nothing to remember, nothing to leak.
          {where ? ` Connected to ${where}.` : ""}
        </p>

        {api.session.status === "connecting" && <p className="sub">Connecting…</p>}
        {api.session.status === "listing" && <AppListing {...LISTING} />}
        {api.session.status === "unconfigured" && (
          <p className="sub" role="alert">
            {api.session.message}
          </p>
        )}

        {api.session.status === "signed-out" && <PasskeySignIn api={api} />}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="mp-btn mp-btn--ghost" onClick={onClose} disabled={api.busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
