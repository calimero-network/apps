import { useMero } from "@calimero-network/mero-react";
import { clearActiveRoom } from "../lib/session";
import styles from "./SessionMenu.module.css";

/**
 * Who you are connected as, and the way out.
 *
 * There was no logout anywhere in this app. `useMero()` has exposed `logout()`
 * all along; nothing called it, so the only way to leave a session was to clear
 * site data by hand. That also made the app impossible to test as a second
 * person on one machine, and it is why opening Mero Meet on an origin another
 * Calimero app had used dropped you straight into a session you never chose.
 *
 * The node URL is shown next to it deliberately: with several dev nodes on one
 * machine, "which node am I on" is the first question when something looks
 * empty, and the answer used to be nowhere on screen.
 */
export default function SessionMenu() {
  const { nodeUrl, logout } = useMero();

  // The active room is OUR state, not the SDK's — `logout()` clears tokens and
  // knows nothing about it. Left behind, the next person to log in on this
  // browser boots straight into the previous session's call: `/` redirects to
  // /lobby whenever a context id is stored, and RequireRoom only checks that
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

  return (
    <div className={styles.root}>
      {host && (
        <span
          className={styles.node}
          title={nodeUrl ?? undefined}
          data-testid="session-node"
        >
          {host}
        </span>
      )}
      <button
        type="button"
        className={styles.logout}
        onClick={signOut}
        data-testid="logout"
        title="Sign out of this node"
      >
        Log out
      </button>
    </div>
  );
}
