import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AcceptInviteDialog } from "@calimero-network/mero-react";
import { isSpentInvite, type PendingInvite } from "@calimero-apps/connect";
import { usePendingInvite } from "@calimero-apps/passkey";

import { useMaybeSignedIn, useSessionApi } from "../sessionContext";
import { PRODUCT_NAME, inviteForum, invites } from "../lib/spaces";
import { setActiveForum } from "../lib/session";
import { takeJoinedAtSignUp } from "../session";
import SignInPanel from "./SignInPanel";
import styles from "./InviteModal.module.css";

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
 *  - signed in: the shared "Join workspace" dialog straight away. It asks rather than joins:
 *    joining puts you in someone's organization, and a forwarded link or a
 *    refreshing background tab should not do that silently. Joining lands in
 *    the forum the link names (on the post it opened, if any) or on the
 *    space's forum list.
 *
 * A link that names its space goes to the dialog with it, which tells a member
 * so without spending the invite. A spent invite (used, expired, revoked) is
 * said by the dialog in the node's own words and dropped from storage, yet
 * stays on screen until "Not now".
 */
export default function InvitationHost({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pending = usePendingInvite(invites);
  const [deferred, setDeferred] = useState(false);
  const [spent, setSpent] = useState<PendingInvite | null>(null);
  /**
   * The route joining (or "Open the space") is going to. The invitation screen
   * stays until the router is there: dropping it first would show the route
   * the visitor is still on, and the landing page's own redirect would win.
   */
  const [leavingFor, setLeavingFor] = useState<{ to: string; from: string; invite: PendingInvite | null } | null>(
    null,
  );
  // The joined invite stays on screen until the router has moved (`leavingFor`).
  const invite = leavingFor ? leavingFor.invite : (spent ?? pending);

  useEffect(() => {
    // Arrived, or the destination redirected on (a guard): either way the router moved.
    if (leavingFor && (pathname === leavingFor.to || pathname !== leavingFor.from)) {
      setLeavingFor(null);
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

  return (
    <main className={styles.page}>
      <AcceptInviteDialog
        client={signedIn.client}
        passkey={signedIn.passkey()}
        open={!leavingFor}
        token={invite.token}
        org={invite.org ?? undefined}
        appName={PRODUCT_NAME}
        labels={{ noun: "space" }}
        onClose={() => {
          setSpent(null);
          invites.drop();
        }}
        onError={(e) => {
          if (!isSpentInvite(e)) return;
          setSpent(invite);
          invites.drop();
        }}
        onJoined={({ org }) => {
          invites.drop();
          land(invite, org || invite.org, invite);
          signedIn.after();
        }}
      />
    </main>
  );
}
