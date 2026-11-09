import { useEffect, useRef, type ReactNode } from "react";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { useDialogOpen } from "../hooks/useDialogOpen";
import { pendingInvite } from "../lib/companies";
import { LISTING, describeTarget } from "../lib/session";
import { useSessionApi } from "../lib/sessionContext";
import styles from "./InviteModal.module.css";
import { UserPlusIcon, XIcon } from "./icons";

/**
 * Sign in with a passkey, or create an account with a new one: the landing
 * page's connect action. Replaces v1's node connect popup (local node
 * discovery, a node URL, the Cloud wallet): on Calimero 1.0 the frontend
 * already knows its cluster (local nodes in dev, the Cloud cluster in
 * production) and an account is a passkey.
 */
export default function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useDialogOpen(dialogRef, open);

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current && !api.busy) onClose();
      }}
      aria-labelledby="signin-title"
      data-testid="signin-dialog"
    >
      <SignInBody
        titleId="signin-title"
        close={
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close" disabled={api.busy}>
            <XIcon size={16} />
          </button>
        }
      />
    </dialog>
  );
}

/**
 * The sign-in itself: title, explanation, the cluster it talks to, and
 * "Continue with passkey" / "Create a passkey". Shared by the dialog above and
 * the invitation page a signed-out visitor sees when they open an invite link
 * (`InvitationPage`), so the copy and the passkey flow cannot drift apart.
 */
export function SignInBody({
  titleId,
  close,
  children,
}: {
  titleId: string;
  /** The dialog's close button; the page has none. */
  close?: ReactNode;
  /** Below the passkey buttons: the page's "Not now". */
  children?: ReactNode;
}) {
  const { api } = useSessionApi();
  const invited = pendingInvite() !== null;
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <div className={styles.body}>
      <header className={styles.head}>
        <span className={styles.tile} aria-hidden>
          <UserPlusIcon size={18} />
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title} id={titleId}>
            {invited ? "You're invited" : "Sign in"}
          </h2>
          <p className={styles.scope}>
            {invited
              ? "You've been invited to join the company in Mero Updates. "
              : ""}
            Accounts are passkeys: nothing to remember, nothing to leak.
            {where ? ` Connected to ${where}.` : ""}
          </p>
        </div>
        {close}
      </header>

      {api.session.status === "connecting" && <p className={styles.scope}>Connecting…</p>}
      {api.session.status === "listing" && <AppListing {...LISTING} />}
      {api.session.status === "unconfigured" && (
        <p className="error" role="alert">
          {api.session.message}
        </p>
      )}

      {api.session.status === "signed-out" && <PasskeySignIn api={api} joining="the company" />}
      {children}
    </div>
  );
}
