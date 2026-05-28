import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminGet, adminPost } from "../api/rpc";
import type { Team } from "../types";
import styles from "./TeamsPage.module.css";

export default function TeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    adminGet<{ groups?: Team[]; namespaces?: Team[] }>("/namespaces")
      .then((data) => setTeams(data.groups ?? data.namespaces ?? []))
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
  }, []);

  async function createTeam() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const data = await adminPost<{ namespaceId?: string; groupId?: string }>(
        "/namespaces",
        { alias: newName.trim() },
      );
      const id = data.namespaceId ?? data.groupId ?? "";
      setTeams((prev) => [...prev, { groupId: id, name: newName.trim() }]);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>MeroDesign</span>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
          />
          <button className={styles.btn} onClick={createTeam} disabled={creating}>
            Create
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : teams.length === 0 ? (
          <p className={styles.empty}>No teams yet. Create one above.</p>
        ) : (
          <div className={styles.grid}>
            {teams.map((t) => (
              <button
                key={t.groupId}
                className={styles.card}
                onClick={() => navigate(`/teams/${t.groupId}/projects`)}
              >
                <span className={styles.cardName}>{t.name || t.groupId.slice(0, 8)}</span>
                <span className={styles.cardSub}>Team</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
