/**
 * The sign-in dialog the landing page's "Open your feed" buttons open: a
 * passkey sign-in, or a new account with a new passkey, on the cluster this
 * build connects to (the local nodes in dev, Calimero Cloud in production).
 *
 * Hand-owned here since Hyperfeed left the shared landing template. v1 opened
 * mero-react's `LoginModal` (a node URL, or a wallet enrolment); a 1.0 cluster
 * signs people in with passkeys, so there is nothing to type.
 */
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { LISTING, useSessionApi, describeTarget } from "../../session";

export interface LoginPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LoginPopup({ isOpen, onClose }: LoginPopupProps) {
  const api = useSessionApi();
  if (!isOpen) return null;
  const { session } = api;
  return (
    <div className="hl-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hl-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hl-signin-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="hl-signin-title">Open your feed</h2>
        {session.status === "connecting" && <p className="muted">Connecting…</p>}
        {session.status === "listing" && <AppListing {...LISTING} />}
        {session.status === "unconfigured" && <pre className="err">{session.message}</pre>}
        {session.status === "signed-out" && (
          <>
            <p className="muted">
              Connected to {describeTarget(session.target)}. Accounts are passkeys: nothing to remember, nothing to leak.
            </p>
            <PasskeySignIn api={api} />
          </>
        )}
        <div className="row">
          <button type="button" className="ghost small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
