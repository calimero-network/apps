import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { adminGet, adminPost } from "../api/rpc";
import InviteModal from "../components/InviteModal";
import type { Project } from "../types";
import styles from "./ProjectsPage.module.css";

export default function ProjectsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    adminGet<{ contexts?: Project[]; items?: Project[] }>(
      `/groups/${teamId}/contexts`,
    )
      .then((data) => setProjects(data.contexts ?? data.items ?? []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [teamId]);

  async function createProject() {
    if (!newName.trim() || !teamId) return;
    setCreating(true);
    try {
      const data = await adminPost<{ contextId?: string; id?: string }>(
        "/contexts",
        { groupId: teamId, alias: newName.trim(), initializationParams: [] },
      );
      const id = data.contextId ?? data.id ?? "";
      setProjects((prev) => [
        ...prev,
        { contextId: id, name: newName.trim(), description: "", isPublic: false },
      ]);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/teams")}>← Teams</button>
        <span className={styles.logo}>MeroDesign</span>
        <div className={styles.headerRight}>
          <button
            className={styles.inviteBtn}
            onClick={() => setShowInvite(true)}
            data-testid="invite-button"
          >
            + Invite member
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Projects</h1>

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New project name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createProject()}
            data-testid="new-project-input"
          />
          <button
            className={styles.btn}
            onClick={createProject}
            disabled={creating}
            data-testid="create-project-btn"
          >
            Create
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : projects.length === 0 ? (
          <p className={styles.empty} data-testid="empty-projects">No projects yet. Create one above.</p>
        ) : (
          <div className={styles.grid}>
            {projects.map((p) => (
              <button
                key={p.contextId}
                className={styles.card}
                data-testid={`project-card-${p.contextId}`}
                onClick={() => navigate(`/teams/${teamId}/projects/${p.contextId}`)}
              >
                <div className={styles.cardThumb} />
                <span className={styles.cardName}>
                  {p.name || p.contextId.slice(0, 8)}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      {showInvite && teamId && (
        <InviteModal teamId={teamId} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}
