import type { ReactNode } from "react";
import { SignInPanel as SharedSignInPanel } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { LISTING } from "../session";
import { useSessionApi } from "../sessionContext";
import styles from "./InviteModal.module.css";

/**
 * The shared sign-in body (`@calimero-apps/passkey`) in this app's dialog
 * styles: the popup (`SignInModal`) and the invitation page
 * (`InvitationHost`) render it. `close` is the popup's close button, put in
 * the header beside the title.
 */
export default function SignInPanel({ titleId, close }: { titleId: string; close?: ReactNode }) {
  const { api } = useSessionApi();
  return (
    <SharedSignInPanel
      api={api}
      appName="Mero Forum"
      joining="the space"
      listing={LISTING}
      titleId={titleId}
      aside={close}
      classNames={{ header: styles.head, title: styles.title, text: styles.hint, error: styles.hint }}
    />
  );
}
