import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeError } from "@calimero-apps/connect";

import { useDialogOpen } from "../hooks/useDialogOpen";
import { setActiveAudience } from "../lib/active";
import { dropInvite, joinedOrg, pendingInvite, type PendingInvite } from "../lib/companies";
import { useMaybeSignedIn } from "../lib/sessionContext";
import styles from "./InviteModal.module.css";
import { UserPlusIcon, XIcon } from "./icons";

/**
 * "Join this company?" for an invitation that arrived as a link
 * (`?invite=<token>`, captured in `main.tsx`), once there is a session.
 *
 * Mounted at the app level, above the router, because a link can land on any
 * route. It asks rather than joins: joining is a state change, and a forwarded
 * link or a background tab that refreshes must not join silently. Joining
 * redeems the org invite; an audience link (`&audience=<id>`) then opens that
 * audience, a company link the company's audience list.
 */
export default function InvitationPrompt() {
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInvite(signedIn ? pendingInvite() : null);
  }, [signedIn]);
  useDialogOpen(dialogRef, !!invite);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const redeemed = await signedIn.client.redeemInvite(invite.token);
      signedIn.after();
      const org = joinedOrg(redeemed);
      dropInvite();
      setInvite(null);
      if (org && invite.audience) {
        setActiveAudience(invite.audience, org);
        navigate("/a");
      } else {
        navigate(org ? `/companies/${org}` : "/companies");
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [signedIn, invite, navigate]);

  if (!invite) return null;
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={() => !busy && dismiss()}
      aria-labelledby="invitation-title"
      data-testid="invitation-dialog"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <span className={styles.tile} aria-hidden>
            <UserPlusIcon size={18} />
          </span>
          <div className={styles.headText}>
            <h2 className={styles.title} id="invitation-title">
              Join this company?
            </h2>
            <p className={styles.scope}>
              {invite.audience
                ? "Joining takes you straight into the audience you were invited to."
                : "Joining gives you access to the company and every audience in it."}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close" disabled={busy}>
            <XIcon size={16} />
          </button>
        </header>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void join()}
          disabled={busy}
          data-testid="invitation-join"
        >
          {busy ? "Joining…" : "Join"}
        </button>
        <button type="button" className="secondary" onClick={dismiss} disabled={busy}>
          Not now
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
