import { ManageInHomeLink } from "@calimero-apps/passkey";

import { describeTarget } from "../session";
import { useSessionApi } from "../sessionContext";
import { clearActiveForum, getActiveNamespaceId } from "../lib/session";
import { AccountChip } from "./chrome";

/**
 * Who you are signed in as, where (merod local, or the Cloud cluster), and the
 * way out. Signing out also forgets the open forum, so the next person to sign
 * in on this browser does not boot into it.
 */
export default function SessionMenu({ name }: { name?: string } = {}) {
  const { api } = useSessionApi();
  const where =
    api.session.status === "signed-in" ? describeTarget(api.session.target) : null;

  const signOut = () => {
    clearActiveForum();
    void api.signOut();
  };

  return (
    <AccountChip
      name={name}
      host={where}
      hostTestId="session-node"
      onLogout={signOut}
      logoutTestId="logout"
    >
      <ManageInHomeLink session={api.session} org={getActiveNamespaceId()} className="x-homeLink" />
    </AccountChip>
  );
}
