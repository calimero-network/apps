import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import ProjectThumbnail from "../components/ProjectThumbnail";
import { EmptyBoardsArt } from "../components/Artwork";
import { IconPlus, IconUserPlus } from "../components/HomeIcons";
import { useShell } from "../components/shell/shellContext";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../utils/errorMessage";
import { pickBoard, readLastVisit } from "../utils/lastVisit";
import { truncateMiddle } from "../utils/format";
import { useTeamName } from "../utils/teamName";
import styles from "./TeamHome.module.css";

/**
 * A team with no board open: every board as a picture, and a field to make a
 * new one, which opens as soon as it exists. The rail lists the same boards;
 * this is the roomy view of them.
 *
 * Arriving with `state.resume` (the shell's resume path: a cold open, a team
 * switch) goes straight on to the board last open in this team, once the team
 * has listed it.
 */
export default function TeamHome() {
  const { teamId, teams, boards, openBoard, openInvite, openSettings } = useShell();
  const { nodeUrl } = useMero();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const listedName = teams.teams.find((t) => t.groupId === teamId)?.name;
  const teamName = useTeamName(teamId ?? undefined, listedName);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const listed = !!teamId && boards.listedFor === teamId;
  const resume = (location.state as { resume?: boolean } | null)?.resume === true;

  useEffect(() => {
    if (!resume || !listed || !teamId) return;
    const target = pickBoard(
      boards.boards.map((b) => b.contextId),
      readLastVisit(nodeUrl).boards?.[teamId],
    );
    if (target) navigate(`/teams/${teamId}/projects/${target}`, { replace: true });
    // Resolved either way: a later visit to this page is a plain one.
    else navigate(location.pathname + location.search, { replace: true, state: null });
  }, [resume, listed, teamId, boards.boards, nodeUrl, navigate, location.pathname, location.search]);

  async function createBoard() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const board = await boards.createBoard(name);
      setNewName("");
      openBoard(board.contextId);
    } catch (err) {
      // Surface node rejections (e.g. the namespace-admin gate on subgroup
      // creation) instead of failing silently in the network console.
      showToast(humanizeError(extractErrorMessage(err, "Could not create board.")));
    } finally {
      setCreating(false);
    }
  }

  const createField = (
    <div className={styles.field}>
      <input
        className={styles.input}
        placeholder="New board name…"
        aria-label="New board name"
        value={newName}
        maxLength={80}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void createBoard()}
        data-testid="new-project-input"
      />
      <button
        className={styles.btn}
        onClick={() => void createBoard()}
        disabled={creating || !newName.trim()}
        data-testid="create-project-btn"
      >
        {creating ? "Creating…" : "Create"}
      </button>
    </div>
  );

  return (
    <div className={styles.scroll}>
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Team</p>
            <h1 className={styles.title}>{teamName}</h1>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.ghostBtn} onClick={() => openSettings("team")} data-testid="team-settings-btn">
              Members &amp; settings
            </button>
            <button className={styles.ghostBtn} onClick={openInvite}>
              <IconUserPlus /> Invite
            </button>
          </div>
        </div>

        {!listed || resume ? (
          <div className={styles.grid} aria-busy="true" aria-label="Loading boards">
            {[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
          </div>
        ) : boards.boards.length === 0 ? (
          <section className={`${styles.panel} ${styles.empty}`} data-testid="empty-projects">
            <EmptyBoardsArt />
            <h2 className={styles.emptyTitle}>Make the first board</h2>
            <p className={styles.emptyText}>
              Name it and it opens right away. Everyone in {teamName} can draw on it with you —
              press Invite to bring them in.
            </p>
            <div className={styles.emptyField}>{createField}</div>
          </section>
        ) : (
          <>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Boards</h2>
              <span className={styles.count}>{boards.boards.length}</span>
            </div>
            <div className={styles.grid}>
              <section className={`${styles.panel} ${styles.newCard}`}>
                <span className={styles.newIcon} aria-hidden="true"><IconPlus /></span>
                <span className={styles.newTitle}>New board</span>
                {createField}
              </section>
              {boards.boards.map((p) => {
                const name = p.name || p.contextId.slice(0, 8);
                return (
                  <button
                    key={p.contextId}
                    className={styles.card}
                    data-testid={`project-card-${p.contextId}`}
                    onClick={() => openBoard(p.contextId)}
                  >
                    <ProjectThumbnail contextId={p.contextId} name={name} className={styles.cardThumb} />
                    <span className={styles.cardBody}>
                      <span className={styles.cardName}>{name}</span>
                      <span className={styles.cardMeta}>
                        Design board <span className={styles.metaDot} aria-hidden="true" />
                        <span className={styles.metaId}>{truncateMiddle(p.contextId, 6, 4)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
