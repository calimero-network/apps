import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useSessionApi } from "../api/sessionContext";
import { SPENT_INVITE_COPY, describeRedeemFailure, isSpentInvite, joinedOrg, memberOf } from "@calimero-apps/connect";
import { inviteRoute, invites, readOrg, setMyTeamName, takeJoinedAtSignUp } from "../api/teams";
import { lastUsedName } from "@calimero-apps/names";
import UsernameModal from "./UsernameModal";
import { legacyUsername } from "../utils/projectName";
import { SignInPanel, usePendingInvite } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { ONBOARDING } from "../api/session";

/** Where joining was going, held while the new member names themselves in the team. */
type Naming = { org: string; route: string };

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
 *    opened inside it). A team that has no name for you asks for one first,
 *    once: every project in the team uses it.
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
  const pending = usePendingInvite(invites);
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  /**
   * The route joining (or "Open the team") is going to. The invitation screen
   * stays until the router is there: dropping it first would show the route
   * the visitor is still on, and the front door's own redirect would win.
   */
  const [leavingFor, setLeavingFor] = useState<{ to: string; from: string; token: string | null } | null>(null);
  // The joined invite stays on screen until the router has moved (`leavingFor`).
  const token = leavingFor ? leavingFor.token : (pending?.token ?? null);

  useEffect(() => {
    // Arrived, or the destination redirected on (a guard): either way the router moved.
    if (leavingFor && (pathname === leavingFor.to || pathname !== leavingFor.from)) {
      setLeavingFor(null);
      setOutcome(null);
    }
  }, [leavingFor, pathname]);

  const client = signedIn?.client ?? null;
  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    const joined = client ? takeJoinedAtSignUp() : null;
    if (joined) navigate(inviteRoute(joined.invite, joined.org));
  }, [client, navigate]);

  const pendingToken = pending?.token ?? null;
  useEffect(() => {
    const current = invites.pending();
    const org = current?.org;
    if (!client || !current || !org) return;
    let live = true;
    setChecking(true);
    // Unknown membership (`null`): ask, as for a link that names no team.
    void memberOf(client, org)
      .then((member) => {
        if (!live || !member) return;
        invites.drop();
        setOutcome({ kind: "member", org, route: inviteRoute(current, org) });
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
      setChecking(false);
    };
  }, [client, pendingToken]);

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

  if (outcome) {
    const done = () => {
      if (outcome.kind === "member") {
        setLeavingFor({ to: outcome.route, from: pathname, token: null });
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
              : SPENT_INVITE_COPY}
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

  const dismiss = () => invites.drop();

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedInClient.redeemInvite(token)) ?? pending?.org ?? null;
      const route = inviteRoute(pending, org);
      invites.drop();
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
    } catch (e) {
      // Only the node's word that the invite is done drops it: a lapsed
      // session, a rate limit or the cluster unreachable keeps it to try again.
      if (isSpentInvite(e)) {
        invites.drop();
        setOutcome({ kind: "spent" });
      } else {
        setError(describeRedeemFailure(e));
      }
    } finally {
      setBusy(false);
      api.store?.sync(signedInClient);
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
          <p className="sub" role="alert" data-testid="invitation-error">
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
