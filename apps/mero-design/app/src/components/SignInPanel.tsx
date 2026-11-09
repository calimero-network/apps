import type { ReactNode } from "react";
import { SignInPanel as SharedSignInPanel } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { PRODUCT_NAME } from "../config";
import { LISTING } from "../session";
import { useSessionApi } from "../sessionContext";
import styles from "./InviteModal.module.css";

/**
 * The shared sign-in body (`@calimero-apps/passkey`) in this app's dialog
 * styles: the popup and the invitation page render it. The flow (create your
 * account and join, join with a passkey, the two-prompt sign-up) is shared.
 */
export default function SignInPanel({
  invited,
  titleId,
  aside,
}: {
  invited: boolean;
  titleId: string;
  /** Rendered beside the title: the popup's close button. */
  aside?: ReactNode;
}) {
  const { api } = useSessionApi();
  return (
    <SharedSignInPanel
      api={api}
      appName={PRODUCT_NAME}
      joining="the team"
      invited={invited}
      listing={LISTING}
      title="Sign in"
      titleId={titleId}
      aside={aside}
      classNames={{ header: styles.header, title: styles.title, text: styles.desc, error: styles.error }}
    />
  );
}
