import { useEffect, useRef, useState } from "react";
import NewTeamDialog from "./NewTeamDialog";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage } from "../../utils/errorMessage";
import { teamLabel } from "../../utils/teamName";
import { initialsOf, tileGradient } from "../../utils/artwork";
import { IconCheck, IconChevron, IconPlus } from "../HomeIcons";
import { useShell } from "./shellContext";
import styles from "./DesignShell.module.css";

/**
 * The top bar's team picker: every team on this node, and "New team" right in
 * the menu. Replaces the Teams page — switching teams no longer means going
 * back to a list, and creating one opens it.
 */
export default function TeamSwitcher({ currentName }: { currentName: string }) {
  const { teamId, teams, openTeam } = useShell();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
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

  async function created(made: { orgId: string; name: string; selfName: string }) {
    setCreating(false);
    try {
      const { id, warning } = await teams.teamCreated(made);
      openTeam(id);
      // Say it now, not at invite time: an unhosted team's invitations cannot
      // be claimed, and "link this account in the wallet" is the fix.
      if (warning) showToast(warning);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not set up the team."));
    }
  }

  const label = teamId ? currentName : "Choose a team";

  return (
    <div className={styles.switcher} ref={ref}>
      <button
        type="button"
        className={styles.switcherBtn}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="team-switcher"
        title={label}
      >
        {teamId && (
          <span className={styles.teamTile} style={{ background: tileGradient(teamId) }} aria-hidden="true">
            {initialsOf(currentName)}
          </span>
        )}
        <span className={styles.switcherLabel}>{label}</span>
        <IconChevron />
      </button>

      {open && (
        <div className={styles.menu} role="menu" data-testid="team-menu">
          {teams.teams.length > 0 && (
            <>
              <p className={styles.menuLabel}>Teams</p>
              <div className={styles.menuList}>
                {teams.teams.map((t) => {
                  const name = teamLabel(t.groupId, t.name);
                  const active = t.groupId === teamId;
                  return (
                    <button
                      key={t.groupId}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`${styles.menuItem} ${active ? styles.menuItemActive : ""}`}
                      onClick={() => {
                        setOpen(false);
                        if (!active) openTeam(t.groupId, { resume: true });
                      }}
                      data-testid={`team-option-${t.groupId}`}
                    >
                      <span className={styles.teamTile} style={{ background: tileGradient(t.groupId) }} aria-hidden="true">
                        {initialsOf(name)}
                      </span>
                      <span className={styles.menuItemText}>{name}</span>
                      {active && <IconCheck />}
                    </button>
                  );
                })}
              </div>
              <div className={styles.menuSep} />
            </>
          )}
          {!teams.listed && teams.teams.length === 0 && (
            <p className={styles.menuNote}>{teams.error ? "Could not load teams." : "Loading teams…"}</p>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            data-testid="new-team-btn"
          >
            <span className={styles.menuIcon} aria-hidden="true"><IconPlus size={15} /></span>
            <span className={styles.menuItemText}>New team</span>
          </button>
        </div>
      )}
      <NewTeamDialog open={creating} onClose={() => setCreating(false)} onCreated={created} />
    </div>
  );
}
