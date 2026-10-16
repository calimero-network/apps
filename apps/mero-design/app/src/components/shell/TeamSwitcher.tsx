import { useEffect, useRef, useState } from "react";
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
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setNewName("");
    }
  }, [open]);

  async function create() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const { id, haError } = await teams.createTeam(name);
      setOpen(false);
      if (id) openTeam(id);
      // Say it now, not at invite time: an unhosted team's invitations cannot
      // be claimed, and "link this account in the wallet" is the fix.
      if (haError) showToast(`Team created, but it is not hosted yet: ${haError}`);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setBusy(false);
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
          {creating ? (
            <div className={styles.inlineField}>
              <input
                autoFocus
                className={styles.inlineInput}
                placeholder="New team name…"
                aria-label="New team name"
                value={newName}
                maxLength={64}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                  if (e.key === "Escape") { e.stopPropagation(); setCreating(false); }
                }}
                data-testid="new-team-input"
              />
              <button
                type="button"
                className={styles.inlineBtn}
                onClick={() => void create()}
                disabled={busy || !newName.trim()}
                data-testid="create-team-btn"
              >
                {busy ? "…" : "Create"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => setCreating(true)}
              data-testid="new-team-btn"
            >
              <span className={styles.menuIcon} aria-hidden="true"><IconPlus size={15} /></span>
              <span className={styles.menuItemText}>New team</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
