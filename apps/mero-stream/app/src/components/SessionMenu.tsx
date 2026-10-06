import { useMero } from "@calimero-network/mero-react";
import { clearActiveRoom } from "../lib/session";
import { LogOutIcon, ServerIcon } from "./icons";
import styles from "./SessionMenu.module.css";

/**
 * Who you are connected as, and the way out.
 *
 * There was no logout anywhere in this app. `useMero()` has exposed `logout()`
 * all along; nothing called it, so the only way to leave a session was to clear
 * site data by hand. That also made the app impossible to test as a second
 * person on one machine, and it is why opening Mero Stream on an origin another
 * Calimero app had used dropped you straight into a session you never chose.
 *
 * The node URL is shown next to it deliberately: with several dev nodes on one
 * machine, "which node am I on" is the first question when something looks
 * empty, and the answer used to be nowhere on screen.
 */
export default function SessionMenu({
  variant = "inline",
}: {
  /** `inline` for a page header; `menu` for rows inside a dropdown. */
  variant?: "inline" | "menu";
} = {}) {
  const { nodeUrl, logout } = useMero();

  // The active room is OUR state, not the SDK's — `logout()` clears tokens and
  // knows nothing about it. Left behind, the next person to log in on this
  // browser boots straight into the previous session's call: `/` redirects to
  // /live whenever a context id is stored, and RequireStream only checks that
  // the context EXISTS, not that it is theirs.
  const signOut = () => {
    clearActiveRoom();
    logout();
  };

  const host = (() => {
    if (!nodeUrl) return null;
    try {
      const u = new URL(nodeUrl);
      // Port included: two dev nodes differ only by it.
      return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
      return nodeUrl;
    }
  })();

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
              <span className={styles.menuNodeLabel}>Connected node</span>
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
          title="Sign out of this node"
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
        title="Sign out of this node"
        aria-label="Log out"
      >
        <LogOutIcon size={16} />
        <span className={styles.logoutText}>Log out</span>
      </button>
    </div>
  );
}
