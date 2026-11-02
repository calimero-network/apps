import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../sessionContext";
import { teamOfBoard } from "../api/rpc";
import { useShell } from "../components/shell/shellContext";
import { pickTeam, readLastVisit } from "../utils/lastVisit";
import styles from "./TeamHome.module.css";

/**
 * `/boards/:projectId` — a link that names a board (its app instance) but not
 * its team.
 *
 * It used to open `/teams/t/projects/<id>`, with `t` as a placeholder team, so
 * the board loaded but everything team-shaped around it (names, the boards
 * list, Back) pointed at a team that does not exist. This finds the real one:
 * the team this browser last opened the board in, if the node still lists it,
 * else the board's own organization.
 */
export default function BoardResolver() {
  const { projectId } = useParams<{ projectId: string }>();
  const { teams } = useShell();
  const { nodeUrl } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectId || (!teams.listed && !teams.error)) return;
    let cancelled = false;
    const ids = teams.teams.map((t) => t.groupId);
    const last = readLastVisit(nodeUrl);
    const go = (team: string) => {
      if (!cancelled) navigate(`/teams/${team}/projects/${projectId}`, { replace: true });
    };

    (async () => {
      const hinted = last.boardTeams?.[projectId];
      if (hinted && ids.includes(hinted)) return go(hinted);
      const team = await teamOfBoard(projectId).catch(() => null);
      if (team) return go(team);
      // Not found (or the listing failed): open it anyway under the likeliest
      // team: the board itself only needs its id.
      go(pickTeam(ids, last.team) ?? "unknown");
    })();
    return () => { cancelled = true; };
  }, [projectId, teams.listed, teams.error, teams.teams, nodeUrl, navigate]);

  return (
    <div className={styles.scroll}>
      <div className={`${styles.page} ${styles.center}`}>
        <p className={styles.emptyText} aria-busy="true">Opening board…</p>
      </div>
    </div>
  );
}
