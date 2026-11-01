import { useSignOut } from "../auth/signOut";
import { describeTarget } from "../lib/session";
import { useMaybeSignedIn } from "../lib/sessionContext";
import type { MeView } from "../lib/updatesClient";
import { usePersonLabel } from "../lib/updates";
import { Avatar } from "./bits";
import styles from "./SessionMenu.module.css";
import { LogOutIcon } from "./icons";

/**
 * Who you are, which cluster you are on, and the way out: the foot of the
 * audience sidebar (and of the phone nav drawer, which is the same element).
 *
 * The cluster is shown deliberately: local nodes in development, a Calimero
 * Cloud cluster in production; "where am I" is the first question when
 * something looks empty.
 */
export default function SessionMenu({ me, roleLabel }: { me: MeView | null; roleLabel: string | null }) {
  const personLabel = usePersonLabel();
  const signedIn = useMaybeSignedIn();
  const signOut = useSignOut();
  const host = signedIn ? describeTarget(signedIn.target) : null;

  const name = me ? personLabel(me.name, me.account) : "Connecting…";

  return (
    <div className={styles.root}>
      {host && (
        <span className={styles.node} title={host} data-testid="session-node">
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
        title="Sign out"
      >
        <LogOutIcon size={15} />
        Log out
      </button>
    </div>
  );
}
