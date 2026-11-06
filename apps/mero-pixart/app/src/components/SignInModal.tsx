import { useEffect } from "react";

import { useSessionApi } from "../api/sessionContext";
import { pendingInvite } from "../api/teams";
import SignInPanel from "./SignInPanel";

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

  return (
    <div className="mp-overlay" data-testid="signin-modal" onClick={() => !api.busy && onClose()}>
      <div
        className="mp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
      >
        <SignInPanel invited={invited} titleId="signin-title" />

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="mp-btn mp-btn--ghost" onClick={onClose} disabled={api.busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
