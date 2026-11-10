import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SPENT_INVITE_COPY, describeRedeemFailure, isSpentInvite, joinedOrg, type PendingInvite } from "@calimero-apps/connect";
import { usePendingInvite } from "@calimero-apps/passkey";

import { useMaybeSignedIn, useSessionApi } from "../sessionContext";
import { inviteForum, invites, roleIn } from "../lib/spaces";
import { setActiveForum } from "../lib/session";
import { takeJoinedAtSignUp } from "../session";
import SignInPanel from "./SignInPanel";
import styles from "./InviteModal.module.css";

/** What the screen says once the invitation can no longer be accepted. */
type Outcome = { kind: "member"; org: string } | { kind: "spent" };

/** A route inside a forum the link opened (a post, the feed), kept after joining. */
const inForum = (route: string | null): route is string => !!route && /^\/(p\/|f$)/.test(route);

/**
 * The invitation screens, wrapped around the routes because a link can land on
 * any of them. `main.tsx` took `?invite=` into storage before React mounted,
 * so the token survives a sign-up. While it is pending the visitor sees a page
 * about the invitation instead of the route:
 *
 *  - signed out: "You're invited", with the same passkey sign-in and sign-up
 *    as the landing page's popup. "Not now" shows the app as usual and keeps
 *    the token, so signing in later still asks.
 *  - signed in: "Join this space?" straight away. It asks rather than joins:
 *    joining puts you in someone's organization, and a forwarded link or a
 *    refreshing background tab should not do that silently. Joining lands in
 *    the forum the link names (on the post it opened, if any) or on the
 *    space's forum list.
 *
 * Redeeming spends one of the invite's uses even for someone already in the
 * space, so a link that names its space is checked against the account's orgs
 * first, and a member is told so instead of being asked. A spent invite (used,
 * expired, revoked) is said plainly, never dropped silently.
 */
export default function InvitationHost({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pending = usePendingInvite(invites);
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /**
   * The route joining (or "Open the space") is going to. The invitation screen
   * stays until the router is there: dropping it first would show the route
   * the visitor is still on, and the landing page's own redirect would win.
   */
  const [leavingFor, setLeavingFor] = useState<{ to: string; from: string; invite: PendingInvite | null } | null>(
    null,
  );
  // The joined invite stays on screen until the router has moved (`leavingFor`).
  const invite = leavingFor ? leavingFor.invite : pending;

  useEffect(() => {
    // Arrived, or the destination redirected on (a guard): either way the router moved.
    if (leavingFor && (pathname === leavingFor.to || pathname !== leavingFor.from)) {
      setLeavingFor(null);
      setOutcome(null);
    }
  }, [leavingFor, pathname]);

  const go = (route: string, held: PendingInvite | null = null) => {
    setLeavingFor({ to: route, from: pathname, invite: held });
    navigate(route);
  };

  /** Into what `link` pointed at, now that the account is in `org`: its forum (and post), else the space. */
  const land = (link: PendingInvite | null, org: string | null, held: PendingInvite | null = null) => {
    const forum = inviteForum(link);
    if (forum) {
      setActiveForum(forum, org);
      go(inForum(link?.route ?? null) ? (link?.route as string) : "/f", held);
    } else {
      go(org ? `/spaces/${org}` : "/spaces", held);
    }
  };

  const client = signedIn?.client ?? null;
  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    const joined = client ? takeJoinedAtSignUp() : null;
    if (joined) land(joined.invite, joined.org);
    // `land` is this render's; it only reads the router and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const token = pending?.token ?? null;
  useEffect(() => {
    const current = invites.pending();
    const org = current?.org;
    if (!client || !current || !org) return;
    let live = true;
    setChecking(true);
    roleIn(client, org)
      .then((role) => {
        if (!live || !role) return;
        invites.drop();
        setOutcome({ kind: "member", org });
      })
      // Unknown membership: ask, as for a link that names no space.
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
      setChecking(false);
    };
  }, [client, token]);

  if (outcome) {
    const member = outcome.kind === "member";
    return (
      <main className={styles.page}>
        <section
          className={`${styles.dialog} ${styles.card}`}
          aria-labelledby="invite-outcome-title"
          data-testid="invitation-outcome"
        >
          <div className={styles.body}>
            <header className={styles.head}>
              <h2 id="invite-outcome-title" className={styles.title}>
                {member ? "You're already in this space" : "This invite cannot be used"}
              </h2>
            </header>
            <p className={styles.hint}>
              {member
                ? "The invitation was for a space you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for."
                : SPENT_INVITE_COPY}
            </p>
            <button
              type="button"
              className={styles.primary}
              data-testid="invitation-continue"
              onClick={() => (outcome.kind === "member" ? go(`/spaces/${outcome.org}`) : setOutcome(null))}
            >
              {member ? "Open the space" : "Continue"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!invite) return <>{children}</>;
  if (api.session.status === "connecting") return null;

  if (!signedIn) {
    if (deferred) return <>{children}</>;
    return (
      <main className={styles.page}>
        <section
          className={`${styles.dialog} ${styles.card}`}
          aria-labelledby="invite-signin-title"
          data-testid="invitation-page"
        >
          <div className={styles.body}>
            <SignInPanel titleId="invite-signin-title" />
            <button
              type="button"
              className="ui-btn"
              onClick={() => setDeferred(true)}
              disabled={api.busy}
              data-testid="invitation-later"
            >
              Not now
            </button>
          </div>
        </section>
      </main>
    );
  }

  const dismiss = () => {
    invites.drop();
    setError(null);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token)) ?? invite.org;
      invites.drop();
      land(invite, org, invite);
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
      signedIn.after();
    }
  };

  return (
    <main className={styles.page}>
      <section
        className={`${styles.dialog} ${styles.card}`}
        aria-labelledby="invite-join-title"
        data-testid="invitation-dialog"
      >
        <div className={styles.body}>
          <header className={styles.head}>
            <h2 id="invite-join-title" className={styles.title}>
              Join this space?
            </h2>
          </header>
          <p className={styles.hint}>
            {inviteForum(invite)
              ? "You were invited to Mero Forum. Joining gives you access to the space and takes you straight into the forum you were invited to."
              : "You were invited to Mero Forum. Joining gives you access to the space and every forum in it."}
          </p>
          {error && (
            <p className={styles.hint} role="alert" data-testid="invitation-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className={styles.primary}
            onClick={() => void join()}
            disabled={busy || checking}
            data-testid="invitation-join"
          >
            {busy || checking ? "Joining…" : error ? "Try again" : "Join"}
          </button>
          <button type="button" className="ui-btn" onClick={dismiss} disabled={busy} data-testid="invitation-dismiss">
            Not now
          </button>
        </div>
      </section>
    </main>
  );
}
