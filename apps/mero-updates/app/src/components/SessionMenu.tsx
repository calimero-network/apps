import { useMero } from "@calimero-network/mero-react";

import { useSignOut } from "../auth/signOut";
import type { MeView } from "../generated/UpdatesClient";
import { personLabel } from "../lib/updates";
import { Avatar } from "./bits";
import styles from "./SessionMenu.module.css";
import { LogOutIcon } from "./icons";

/**
 * Who you are, which node you are on, and the way out: the foot of the
 * audience sidebar (and of the phone nav drawer, which is the same element).
 *
 * There was no logout anywhere in this app at first. `useMero()` has exposed
 * `logout()` all along; nothing called it, so the only way to leave a session
 * was to clear site data by hand. That also made the app impossible to test as
 * a second person on one machine.
 *
 * The node URL is shown deliberately: with several dev nodes on one machine,
 * "which node am I on" is the first question when something looks empty.
 */
export default function SessionMenu({ me, roleLabel }: { me: MeView | null; roleLabel: string | null }) {
  const { nodeUrl } = useMero();
  const signOut = useSignOut();

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

  const name = me ? personLabel(me.name, me.account) : "Connecting…";

  return (
    <div className={styles.root}>
      {host && (
        <span className={styles.node} title={nodeUrl ?? undefined} data-testid="session-node">
          <span className={styles.dot} aria-hidden />
          <span className={styles.nodeText}>{host}</span>
        </span>
      )}
      <div className={styles.identity} data-testid="identity">
        {me ? (
          <Avatar name={me.name} account={me.account} team={me.is_team} />
        ) : (
          <span className="avatar" aria-hidden />
        )}
        <span className={styles.who}>
          <span className={styles.name} title={name}>
            {name}
          </span>
          {roleLabel && (
            <span className={styles.role} data-team={!!me?.is_team}>
              {roleLabel}
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        className={styles.logout}
        onClick={signOut}
        data-testid="logout"
        title="Sign out of this node"
      >
        <LogOutIcon size={15} />
        Log out
      </button>
    </div>
  );
}
