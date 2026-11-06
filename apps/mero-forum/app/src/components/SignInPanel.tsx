import type { ReactNode } from "react";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { LISTING, describeTarget } from "../session";
import { useSessionApi } from "../sessionContext";
import styles from "./InviteModal.module.css";

/**
 * The sign-in content: one passkey screen that both signs in and creates an
 * account. Shared by the popup (`SignInModal`) and the invitation page a
 * signed-out invite link lands on (`InvitationPage`), so the copy and the
 * passkey flow cannot drift apart. `close` is the popup's close button, put in
 * the header beside the title.
 */
export default function SignInPanel({
  invited,
  titleId,
  close,
}: {
  invited: boolean;
  titleId: string;
  close?: ReactNode;
}) {
  const { api } = useSessionApi();
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <header className={styles.head}>
        {close}
        <h2 id={titleId} className={styles.title}>
          {invited ? "You're invited" : "Sign in or create an account"}
        </h2>
      </header>
      <p className={styles.hint}>
        {invited ? "You've been invited to join a space in Mero Forum. Sign in, or create an account, to accept. " : ""}
        Accounts are passkeys: nothing to remember, nothing to leak.
        {where ? ` Connected to ${where}.` : ""}
      </p>

      {api.session.status === "connecting" && <p className={styles.hint}>Connecting…</p>}
      {api.session.status === "listing" && <AppListing {...LISTING} />}
      {api.session.status === "unconfigured" && (
        <p className={styles.hint} role="alert">
          {api.session.message}
        </p>
      )}

      {api.session.status === "signed-out" && <PasskeySignIn api={api} />}
    </>
  );
}
