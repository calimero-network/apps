import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { LISTING, describeTarget } from "../api/session";
import { useSessionApi } from "../api/sessionContext";

/**
 * The sign-in content: one passkey screen that both signs in and creates an
 * account. Shared by the popup (`SignInModal`) and the invitation page a
 * signed-out invite link lands on (`InvitationPage`), so the copy and the
 * passkey flow cannot drift apart.
 */
export default function SignInPanel({ invited, titleId }: { invited: boolean; titleId: string }) {
  const { api } = useSessionApi();
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <h2 id={titleId}>{invited ? "You're invited" : "Sign in or create an account"}</h2>
      <p className="sub">
        {invited ? "You've been invited to join a team in Mero PixArt. Sign in, or create an account, to accept. " : ""}
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
    </>
  );
}
