import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { messageOf } from "../api/pixart";
import { useSessionApi } from "../api/sessionContext";
import {
  SPENT_INVITE,
  dropInvite,
  isSpentInvite,
  joinedOrg,
  listTeams,
  pendingInvite,
  pendingInviteOrg,
  pendingInviteRoute,
} from "../api/teams";
import SignInPanel from "./SignInPanel";

/** What the screen says once the invitation can no longer be accepted. */
type Outcome = { kind: "member"; org: string; route: string } | { kind: "spent" };

/**
 * The invitation screens, wrapped around the routes because a link can land on
 * any of them. `main.tsx` took `?invite=` into storage before React mounted,
 * so the token survives a sign-up. While it is pending the visitor sees a page
 * about the invitation instead of the route:
 *
 *  - signed out: "You're invited", with the same passkey sign-in and sign-up
 *    as the landing page's popup. "Not now" shows the app as usual and keeps
 *    the token, so signing in later still asks.
 *  - signed in: "Join the team?" straight away. The org invite is redeemed
 *    only on the click, and joining opens the team (or the route the link
 *    opened inside it).
 *
 * Redeeming spends one of the invite's uses even for someone already in the
 * team, so a link that names its team is checked against the account's teams
 * first, and a member is told so instead of being asked. A spent invite (used,
 * expired, revoked) is said plainly, never dropped silently.
 */
export default function InvitationHost({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const signedIn = api.session.status === "signed-in" ? api.session : null;
  const [token, setToken] = useState<string | null>(() => pendingInvite());
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /**
   * The route joining (or "Open the team") is going to. The invitation screen
   * stays until the router is there: dropping it first would show the route
   * the visitor is still on, and the front door's own redirect would win.
   */
  const [leavingFor, setLeavingFor] = useState<{ to: string; from: string } | null>(null);

  useEffect(() => {
    // Arrived, or the destination redirected on (a guard): either way the router moved.
    if (leavingFor && (pathname === leavingFor.to || pathname !== leavingFor.from)) {
      setLeavingFor(null);
      setOutcome(null);
      setToken(null);
    }
  }, [leavingFor, pathname]);

  useEffect(() => {
    if (!signedIn) return;
    const current = pendingInvite();
    setToken(current);
    const org = pendingInviteOrg();
    if (!current || !org) return;
    let live = true;
    setChecking(true);
    listTeams(signedIn.client)
      .then((teams) => {
        if (!live || !teams.some((t) => t.groupId === org)) return;
        const route = pendingInviteRoute(org);
        dropInvite();
        setToken(null);
        setOutcome({ kind: "member", org, route });
      })
      // Unknown membership: ask, as for a link that names no team.
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [signedIn]);

  if (outcome) {
    const done = () => {
      if (outcome.kind === "member") {
        setLeavingFor({ to: outcome.route, from: pathname });
        navigate(outcome.route);
      } else {
        setOutcome(null);
      }
    };
    return (
      <main className="mp-invite-page">
        <div className="mp-modal" role="region" aria-labelledby="invite-outcome-title" data-testid="invitation-outcome">
          <h2 id="invite-outcome-title">
            {outcome.kind === "member" ? "You're already in this team" : "This invite cannot be used"}
          </h2>
          <p className="sub">
            {outcome.kind === "member"
              ? "The invitation was for a team you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for."
              : SPENT_INVITE}
          </p>
          <div className="mp-invite-actions">
            <button className="mp-btn mp-btn--primary" data-testid="invitation-continue" onClick={done}>
              {outcome.kind === "member" ? "Open the team" : "Continue"}
            </button>
          </div>
        </div>
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
          <SignInPanel titleId="invite-signin-title" />
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

  const { client } = signedIn;

  const dismiss = () => {
    dropInvite();
    setToken(null);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await client.redeemInvite(token));
      const route = pendingInviteRoute(org);
      dropInvite();
      setLeavingFor({ to: route, from: pathname });
      navigate(route);
    } catch (e) {
      if (isSpentInvite(e)) {
        dropInvite();
        setToken(null);
        setOutcome({ kind: "spent" });
      } else {
        setError(`The invitation could not be accepted: ${messageOf(e)}`);
      }
    } finally {
      setBusy(false);
      api.store?.sync(client);
    }
  };

  return (
    <main className="mp-invite-page">
      <div className="mp-modal" role="region" aria-labelledby="invite-join-title" data-testid="invitation-dialog">
        <h2 id="invite-join-title">Join the team?</h2>
        <p className="sub">
          You were invited to a team on Mero PixArt. Joining makes you a member: you will see its projects and can
          open and edit their images.
        </p>
        {error && (
          <p className="sub" role="alert">
            {error}
          </p>
        )}
        <div className="mp-invite-actions">
          <button className="mp-btn mp-btn--ghost" onClick={dismiss} disabled={busy}>
            Not now
          </button>
          <button
            className="mp-btn mp-btn--primary"
            data-testid="invitation-join"
            onClick={() => void join()}
            disabled={busy || checking}
          >
            {busy || checking ? "Joining…" : error ? "Try again" : "Join"}
          </button>
        </div>
      </div>
    </main>
  );
}
