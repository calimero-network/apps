import { describeTarget, useSessionApi } from "../session";
import { clearActiveRoom } from "../lib/session";
import { LogOutIcon, ServerIcon } from "./icons";
import styles from "./SessionMenu.module.css";

/**
 * Who you are signed in as, where, and the way out.
 *
 * v1 showed the node URL and called mero-react's `logout()`. Here it is the
 * cluster the client talks to (`merod local (3 nodes)` in development, the
 * Cloud cluster's name in production) and the passkey session's sign-out.
 */
export default function SessionMenu({
  variant = "inline",
}: {
  /** `inline` for a page header; `menu` for rows inside a dropdown. */
  variant?: "inline" | "menu";
} = {}) {
  const { session, signOut: endSession } = useSessionApi();
  const signedIn = session.status === "signed-in" ? session : null;

  const signOut = () => {
    clearActiveRoom();
    void endSession();
  };

  const host = signedIn ? describeTarget(signedIn.target) : null;
  const nodeUrl = signedIn ? `${host} · ${signedIn.accountId}` : null;

  if (variant === "menu") {
    return (
      <div className={styles.menuRoot}>
        {host && (
          <span
            className={styles.menuNode}
            title={nodeUrl ?? undefined}
            data-testid="session-node"
          >
            <ServerIcon size={16} />
            <span className={styles.menuNodeText}>
              <span className={styles.menuNodeLabel}>Signed in on</span>
              <span className={styles.menuNodeHost}>{host}</span>
            </span>
          </span>
        )}
        <button
          type="button"
          role="menuitem"
          className={styles.menuLogout}
          onClick={signOut}
          data-testid="logout"
          title="Sign out"
        >
          <LogOutIcon size={16} />
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {host && (
        <span
          className={styles.node}
          title={nodeUrl ?? undefined}
          data-testid="session-node"
        >
          <span className={styles.nodeDot} aria-hidden="true" />
          {host}
        </span>
      )}
      <button
        type="button"
        className={styles.logout}
        onClick={signOut}
        data-testid="logout"
        title="Sign out"
        aria-label="Log out"
      >
        <LogOutIcon size={16} />
        <span className={styles.logoutText}>Log out</span>
      </button>
    </div>
  );
}
