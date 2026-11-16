import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useSessionApi } from "../api/sessionContext";
import { AcceptInviteDialog } from "@calimero-network/mero-react";
import { isSpentInvite, type PendingInvite } from "@calimero-apps/connect";
import { PRODUCT_NAME, inviteRoute, invites, readOrg, setMyTeamName, takeJoinedAtSignUp } from "../api/teams";
import { lastUsedName } from "@calimero-apps/names";
import UsernameModal from "./UsernameModal";
import { legacyUsername } from "../utils/projectName";
import { SignInPanel, usePendingInvite } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { ONBOARDING } from "../api/session";

/** Where joining was going, held while the new member names themselves in the team. */
type Naming = { org: string; route: string };

/**
 * The invitation screens, wrapped around the routes because a link can land on
 * any of them. `main.tsx` took `?invite=` into storage before React mounted,
 * so the token survives a sign-up. While it is pending the visitor sees a page
 * about the invitation instead of the route:
 *
 *  - signed out: "You're invited", with the same passkey sign-in and sign-up
 *    as the landing page's popup. "Not now" shows the app as usual and keeps
 *    the token, so signing in later still asks.
 *  - signed in: the shared "Join workspace" dialog straight away. The org invite
 *    is redeemed only on its Join, and joining opens the team (or the route the
 *    link opened inside it). A team that has no name for you asks for one first,
 *    once: every project in the team uses it.
 *
 * A link that names its team goes to the dialog with it, which tells a member
 * so without spending the invite. A spent invite (used, expired, revoked) is
 * said by the dialog in the node's own words and dropped from storage, yet
 * stays on screen until "Not now".
 */
export default function InvitationHost({ children }: { children: ReactNode }) {
  const { api, deps } = useSessionApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const signedIn = api.session.status === "signed-in" ? api.session : null;
  const pending = usePendingInvite(invites);
  const [deferred, setDeferred] = useState(false);
  const [spent, setSpent] = useState<PendingInvite | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  /**
   * The route joining (or "Open the team") is going to. The invitation screen
   * stays until the router is there: dropping it first would show the route
   * the visitor is still on, and the front door's own redirect would win.
   */
  const [leavingFor, setLeavingFor] = useState<{ to: string; from: string; token: string | null } | null>(null);
  // The joined invite stays on screen until the router has moved (`leavingFor`).
  const shown = spent ?? pending;
  const token = leavingFor ? leavingFor.token : (shown?.token ?? null);

  useEffect(() => {
    // Arrived, or the destination redirected on (a guard): either way the router moved.
    if (leavingFor && (pathname === leavingFor.to || pathname !== leavingFor.from)) {
      setLeavingFor(null);
    }
  }, [leavingFor, pathname]);

  const client = signedIn?.client ?? null;
  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    const joined = client ? takeJoinedAtSignUp() : null;
    if (joined) navigate(inviteRoute(joined.invite, joined.org));
  }, [client, navigate]);

  if (naming && signedIn) {
    const named = async (name: string) => {
      // Best effort: the team's first project asks again if this did not land.
      await setMyTeamName(signedIn.client, naming.org, signedIn.accountId, name).catch(() => {});
      api.store?.sync(signedIn.client);
      setNaming(null);
      setLeavingFor({ to: naming.route, from: pathname, token: null });
      navigate(naming.route);
    };
    return (
      <main className="mp-invite-page">
        <UsernameModal onSubmit={(n) => void named(n)} initialValue={lastUsedName() || legacyUsername()} />
      </main>
    );
  }

  if (!token) return <>{children}</>;
  if (api.session.status === "connecting") return null;

  if (!signedIn) {
    if (deferred) return <>{children}</>;
    return (
      <main className="mp-invite-page">
        <div className="mp-modal" role="region" aria-labelledby="invite-signin-title" data-testid="invitation-page">
          <SignInPanel {...ONBOARDING} api={api} titleId="invite-signin-title" />
          <div className="mp-invite-actions mp-invite-actions--center">
            <button
              className="mp-btn mp-btn--ghost"
              data-testid="invitation-later"
              onClick={() => setDeferred(true)}
              disabled={api.busy}
            >
              Not now
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { client: signedInClient } = signedIn;

  const joined = async (org: string | null) => {
    const route = inviteRoute(pending, org);
    invites.drop();
    api.store?.sync(signedInClient);
    // Your name in the team, asked once, here: never again on its projects.
    // Unknown (the read failed): the team's first project asks instead.
    const named = org
      ? await readOrg(signedInClient, org).then((o) => o.names.has(signedIn.accountId), () => true)
      : true;
    if (org && !named) {
      setNaming({ org, route });
      return;
    }
    setLeavingFor({ to: route, from: pathname, token });
    navigate(route);
  };

  return (
    <main className="mp-invite-page">
      <AcceptInviteDialog
        client={signedInClient}
        passkey={deps.passkey()}
        open={!leavingFor}
        token={token}
        org={shown?.org ?? undefined}
        appName={PRODUCT_NAME}
        labels={{ noun: "team" }}
        onClose={() => {
          setSpent(null);
          invites.drop();
        }}
        onError={(e) => {
          if (!isSpentInvite(e) || !pending) return;
          setSpent(pending);
          invites.drop();
        }}
        onJoined={({ org }) => void joined(org || pending?.org || null)}
      />
    </main>
  );
}
