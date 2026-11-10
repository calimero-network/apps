import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { publishMyName } from "../api/names";
import { readTeam, redeemInvitation } from "../api/rpc";
import { suggestedName } from "../utils/boardName";
import UsernameModal from "./UsernameModal";
import { useAuth } from "../sessionContext";
import { isSpentInvite } from "@calimero-apps/connect";
import { usePendingInvite } from "@calimero-apps/passkey";
import { inviteDestination, inviteFailure, invites, takeJoinedAtSignUp } from "../utils/inviteLink";
import styles from "./InviteModal.module.css";

/**
 * "Join this team?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render, see `captureInvite`).
 *
 * Mounted once, above the routes, because a link can land on any page. It
 * asks rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 *
 * Signed out it renders nothing: the invitation is then the whole page
 * (`InvitationPage`, on the front door), whose sign-in brings the visitor
 * straight back here. Signed in, Join redeems the org invite and opens the
 * team, or the route the link was opened on. A team that has no name for you
 * asks for one first, once: every board in the team uses it.
 *
 * ⚠️ Someone already in the team is not offered Join. Redeeming spends the
 * link's single use, so the owner testing their own link used to leave the
 * person it was meant for with "unknown invite". When the link names its team
 * (`&org=`) and the team lists this account, the token is dropped and the
 * prompt says so instead; when it cannot tell, it asks as before.
 */
export default function InvitationPrompt() {
  const { isAuthenticated: signedIn, accountId } = useAuth();
  const navigate = useNavigate();
  const pending = usePendingInvite(invites);
  // An invite this screen is done with (already in, or spent) stays shown
  // until closed, though the store has dropped it.
  const [held, setHeld] = useState<typeof pending>(null);
  const invite = held ?? pending;
  const [member, setMember] = useState<"checking" | "yes" | "no">("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);
  // Joined, and asking your name in the team before going on to `to`.
  const [naming, setNaming] = useState<{ org: string; to: string } | null>(null);

  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    if (!signedIn) return;
    const to = takeJoinedAtSignUp();
    if (to) navigate(to, { replace: true });
  }, [signedIn, navigate]);

  useEffect(() => {
    if (!signedIn || !invite) return;
    if (!invite.org || !accountId) {
      setMember("no");
      return;
    }
    let live = true;
    setMember("checking");
    readTeam(invite.org)
      .then((team) => {
        if (!live) return;
        if (team.roles.has(accountId)) {
          setHeld(invite);
          invites.drop();
          setMember("yes");
        } else setMember("no");
      })
      // Not a member reads as a refusal here; either way, ask.
      .catch(() => live && setMember("no"));
    return () => {
      live = false;
    };
  }, [signedIn, invite, accountId]);

  const close = useCallback(() => {
    setHeld(null);
    setError(null);
    setSpent(false);
  }, []);

  const dismiss = useCallback(() => {
    invites.drop();
    close();
  }, [close]);

  const open = useCallback(() => {
    const target = inviteDestination(invite, invite?.org ?? null);
    close();
    navigate(target);
  }, [invite, close, navigate]);

  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const org = (await redeemInvitation(invite.token)) ?? invite.org ?? null;
      invites.drop();
      const to = inviteDestination(invite, org);
      // Your name in the team, asked once, here: never again on its boards.
      // Unknown (the read failed): the team's first board asks instead.
      const named = org && accountId ? await readTeam(org).then((t) => t.names.has(accountId), () => true) : true;
      if (org && !named) setNaming({ org, to });
      else navigate(to);
    } catch (e) {
      // A refusal (unknown, used, expired, revoked) can never succeed: drop
      // it. Anything else (a lapsed session, a rate limit, the cluster
      // unreachable) is kept for another try.
      if (isSpentInvite(e)) {
        setHeld(invite);
        invites.drop();
        setSpent(true);
      }
      setError(inviteFailure(e));
    } finally {
      setBusy(false);
    }
  }, [signedIn, invite, accountId, navigate]);

  const named = useCallback(
    async (name: string) => {
      if (!naming) return;
      // Best effort: refused, the team's first board asks again.
      if (accountId) await publishMyName(naming.org, accountId, name).catch(() => {});
      setNaming(null);
      navigate(naming.to);
    },
    [naming, accountId, navigate],
  );

  if (naming && signedIn) {
    return createPortal(
      <UsernameModal onSubmit={(n) => void named(n)} initialValue={suggestedName(accountId)} />,
      document.body,
    );
  }

  if (!invite || !signedIn || member === "checking") return null;

  const already = member === "yes";

  return createPortal(
    <div className={styles.overlay}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invitation-title"
        data-testid="invitation-dialog"
      >
        <div className={styles.header}>
          <h2 id="invitation-title" className={styles.title}>
            {already ? "You're already in this team" : "You're invited to Mero Design"}
          </h2>
        </div>
        <p className={styles.desc}>
          {already
            ? "This account is already a member, so there is nothing to accept. The link is left unused for the person it was meant for."
            : "Joining gives you access to the team and every board in it."}
        </p>
        {error && (
          <p className={styles.error} role="alert" data-testid="invitation-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          {already ? (
            <button type="button" className={styles.primaryBtn} onClick={open} data-testid="invitation-open">
              Open the team
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={spent ? close : dismiss}
                disabled={busy}
                data-testid="invitation-dismiss"
              >
                {spent ? "Close" : "Not now"}
              </button>
              {!spent && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void join()}
                  disabled={busy}
                  data-testid="invitation-join"
                >
                  {busy ? "Joining…" : "Join"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
