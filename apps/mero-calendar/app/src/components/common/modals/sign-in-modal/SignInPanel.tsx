import { SignInPanel as SharedSignInPanel } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { LISTING } from "../../../../api/session";
import { useSessionApi } from "../../../../api/sessionContext";
import styles from "../username-modal/username-modal.module.scss";

/**
 * The shared sign-in body (`@calimero-apps/passkey`) in this app's modal
 * styles: the popup and the invitation page render it. The flow (create your
 * account and join, join with a passkey, the two-prompt sign-up) is shared.
 */
export default function SignInPanel({ invited, titleId }: { invited: boolean; titleId?: string }) {
  const { api } = useSessionApi();
  return (
    <SharedSignInPanel
      api={api}
      appName="Mero Calendar"
      joining="the team"
      invited={invited}
      listing={LISTING}
      title="Sign in"
      titleId={titleId}
      classNames={{ title: styles.title, text: styles.sub, error: styles.sub }}
    />
  );
}
