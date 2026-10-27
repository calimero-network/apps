import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMero } from "@calimero-apps/cloud";
import { EmptyTeamsArt } from "../components/Artwork";
import { useShell } from "../components/shell/shellContext";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { pickTeam, readLastVisit } from "../utils/lastVisit";
import styles from "./TeamHome.module.css";

/**
 * `/teams` — no team in the URL. Where a sign-in, the desktop window and the
 * old "Teams" link land, so it never stops here when it does not have to: it
 * goes on to the team you had open last (if this node still lists it, else the
 * first one), and on from there to that team's last board.
 *
 * Only a node with no team at all shows anything: the one field it needs.
 */
export default function TeamIndex() {
  const { teams } = useShell();
  const { nodeUrl } = useMero();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (!teams.listed) {
    return (
      <div className={styles.scroll}>
        <div className={`${styles.page} ${styles.center}`}>
          {teams.error ? (
            <section className={`${styles.panel} ${styles.empty}`}>
              <h2 className={styles.emptyTitle}>Could not reach your node</h2>
              <p className={styles.emptyText}>Your teams could not be listed. Check the node is running, then try again.</p>
              <div className={styles.emptyField}>
                <button className={styles.btn} onClick={() => void teams.reload()}>Try again</button>
              </div>
            </section>
          ) : (
            <div className={styles.grid} aria-busy="true" aria-label="Loading teams">
              {[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
            </div>
          )}
        </div>
      </div>
    );
  }

  const target = pickTeam(teams.teams.map((t) => t.groupId), readLastVisit(nodeUrl).team);
  if (target) return <Navigate to={`/teams/${target}/projects`} replace state={{ resume: true }} />;

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const { id, haError } = await teams.createTeam(trimmed);
      if (haError) showToast(`Team created, but it is not hosted yet: ${haError}`);
      if (id) navigate(`/teams/${id}/projects`);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.scroll}>
      <div className={`${styles.page} ${styles.center}`}>
        <section className={`${styles.panel} ${styles.empty}`} data-testid="empty-teams">
          <EmptyTeamsArt />
          <h1 className={styles.emptyTitle}>Start your first team</h1>
          <p className={styles.emptyText}>
            A team is the people you design with. Its boards live on its members&rsquo; nodes and
            sync between them directly. Name it to start — or open an invitation link someone sent you.
          </p>
          <div className={styles.emptyField}>
            <div className={styles.field}>
              <input
                className={styles.input}
                placeholder="New team name…"
                aria-label="New team name"
                value={name}
                maxLength={64}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
                data-testid="first-team-input"
              />
              <button className={styles.btn} onClick={() => void create()} disabled={busy || !name.trim()} data-testid="first-team-create">
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
