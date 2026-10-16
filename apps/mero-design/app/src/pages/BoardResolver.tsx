import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { listTeamContexts } from "../api/teamContexts";
import { useShell } from "../components/shell/shellContext";
import { pickTeam, readLastVisit } from "../utils/lastVisit";
import styles from "./TeamHome.module.css";

/**
 * `/boards/:projectId` — a link that names a board but not its team. The
 * desktop app opens a board this way: it knows the context, never the team.
 *
 * It used to open `/teams/t/projects/<id>`, with `t` as a placeholder team, so
 * the board loaded but everything team-shaped around it (names, the boards
 * list, Back) pointed at a team that does not exist. This finds the real one:
 * the team this browser last opened the board in, if the node still lists it,
 * else the team whose boards include it.
 */
export default function BoardResolver() {
  const { projectId } = useParams<{ projectId: string }>();
  const { teams } = useShell();
  const { nodeUrl } = useMero();
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
      for (const id of ids) {
        if (cancelled) return;
        if ((await listTeamContexts(id)).includes(projectId)) return go(id);
      }
      // Not found (still syncing, or listing failed): open it anyway under the
      // likeliest team — the board itself only needs its context id.
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
