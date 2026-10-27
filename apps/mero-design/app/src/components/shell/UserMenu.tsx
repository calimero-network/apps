import { useEffect, useRef, useState } from "react";
import { useMero } from "@calimero-apps/cloud";
import { useMyName } from "@calimero-apps/names";
import { initialsOf } from "../../utils/artwork";
import { truncateMiddle } from "../../utils/format";
import { IconLogout, IconSettings } from "../HomeIcons";
import { useShell } from "./shellContext";
import styles from "./DesignShell.module.css";

/** Who you are, in the top bar's corner: your name, team settings, Logout. */
export default function UserMenu({ account, onLogout }: { account: string; onLogout: () => void }) {
  const { admin, nodeUrl } = useMero();
  const { teamId, openSettings } = useShell();
  const me = useMyName(admin, teamId ?? undefined, account);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = me.name || (account ? truncateMiddle(account, 6, 4) : "You");
  const node = (nodeUrl ?? "").replace(/^https?:\/\//, "");

  return (
    <div className={styles.userWrap} ref={ref}>
      <button
        type="button"
        className={styles.userBtn}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={name}
        data-testid="user-menu"
      >
        {me.name ? initialsOf(me.name) : "·"}
      </button>
      {open && (
        <div className={`${styles.menu} ${styles.menuRight}`} role="menu">
          <div className={styles.userHead}>
            <span className={styles.userName}>{name}</span>
            {node && <span className={styles.userNode} title={nodeUrl ?? ""}>{node}</span>}
          </div>
          <div className={styles.menuSep} />
          {teamId && (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => { setOpen(false); openSettings("team"); }}
              data-testid="user-menu-settings"
            >
              <span className={styles.menuIcon} aria-hidden="true"><IconSettings /></span>
              <span className={styles.menuItemText}>Team settings</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => { setOpen(false); onLogout(); }}
            data-testid="logout-btn"
          >
            <span className={styles.menuIcon} aria-hidden="true"><IconLogout /></span>
            <span className={styles.menuItemText}>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}
