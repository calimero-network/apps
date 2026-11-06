import { useSessionApi } from "../api/sessionContext";
import SignInPanel from "./SignInPanel";

/**
 * What an invite link opened while signed out lands on: the invitation itself,
 * as a page, instead of the landing hero with the invite hidden behind a
 * button. The content is the sign-in popup's (`SignInPanel`), so signing in or
 * creating an account here is the same passkey flow; once a session exists the
 * invitation is redeemed (`InvitationPrompt`). "Not now" goes to the landing
 * page and keeps the token, so the invite is still waiting at the next sign-in.
 */
export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  const { api } = useSessionApi();
  return (
    <main className="mp-invite-page" data-testid="invitation-page">
      <div className="mp-modal" role="region" aria-labelledby="invitation-page-title">
        <SignInPanel invited titleId="invitation-page-title" />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <button
            className="mp-btn mp-btn--ghost"
            data-testid="invitation-not-now"
            onClick={onNotNow}
            disabled={api.busy}
          >
            Not now
          </button>
        </div>
      </div>
    </main>
  );
}
