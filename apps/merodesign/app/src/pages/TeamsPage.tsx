import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminPost, adminDelete, listNamespaces } from "../api/rpc";
import { useAuthStore } from "../store/authStore";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import type { Team } from "../types";
import styles from "./TeamsPage.module.css";

type NamespaceRaw = {
  namespaceId?: string;
  groupId?: string;
  id?: string;
  alias?: string;
  name?: string;
};

export default function TeamsPage() {
  const navigate = useNavigate();
  const { applicationId, clearAuth } = useAuthStore();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function loadTeams() {
      listNamespaces<NamespaceRaw[]>(applicationId)
        .then((items) => {
          const arr = Array.isArray(items) ? items : [];
          setTeams(arr.map((n) => ({
            groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
            name: n.alias ?? n.name ?? "",
          })));
        })
        .catch(() => setTeams([]))
        .finally(() => setLoading(false));
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => clearInterval(id);
  }, [applicationId]);

  // Close menu on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function createTeam() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const data = await adminPost<{ namespaceId?: string; groupId?: string; id?: string }>(
        "/namespaces",
        { applicationId, alias: newName.trim(), name: newName.trim(), upgradePolicy: "LazyOnAccess" },
      );
      const id = data.namespaceId ?? data.groupId ?? data.id ?? "";
      setTeams((prev) => [...prev, { groupId: id, name: newName.trim() }]);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await adminDelete(`/namespaces/${teamId}`);
    } catch {
      // best-effort
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }

  async function joinTeam() {
    const raw = joinCode.trim();
    if (!raw) return;
    setJoining(true);
    setJoinError("");
    try {
      // Decode base64url → JSON invitation object
      const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
      const pad = padded.length % 4;
      const invObj = JSON.parse(atob(pad ? padded + "=".repeat(4 - pad) : padded)) as Record<string, unknown>;

      // Invitation structure: { invitation: { invitation: { group_id: [...] }, inviterSignature, applicationId }, groupName? }
      // group_id lives at invObj.invitation.invitation.group_id
      const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
      const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
      const rawGroupId = inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
      const namespaceId = Array.isArray(rawGroupId)
        ? (rawGroupId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
        : String(rawGroupId ?? "");

      if (!namespaceId) throw new Error("no namespace id in invitation");

      // Join body must wrap the invitation struct (outer), not the whole decoded token
      await adminPost(`/namespaces/${namespaceId}/join`, { invitation: outer });
      // Refresh list
      const items = await listNamespaces<NamespaceRaw[]>(applicationId);
      const arr = Array.isArray(items) ? items : [];
      setTeams(arr.map((n) => ({ groupId: n.namespaceId ?? n.groupId ?? n.id ?? "", name: n.alias ?? n.name ?? "" })));
      setJoinCode("");
    } catch {
      setJoinError("Could not join. Check the invitation code.");
    } finally {
      setJoining(false);
    }
  }

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}><Logo size={24} /> MeroDesign</span>
        <div className={styles.headerRight}>
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
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
              <div key={t.groupId} className={styles.cardWrap} ref={menuOpenId === t.groupId ? menuRef : null}>
                <button
                  className={styles.card}
                  onClick={() => navigate(`/teams/${t.groupId}/projects`)}
                >
                  <span className={styles.cardName}>{t.name || t.groupId.slice(0, 8)}</span>
                  <span className={styles.cardSub}>Team</span>
                </button>
                <button
                  className={styles.menuBtn}
                  onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === t.groupId ? null : t.groupId); }}
                  title="More options"
                >⋯</button>
                {menuOpenId === t.groupId && (
                  <div className={styles.dropdown}>
                    <button className={styles.dropdownItem} onClick={() => { setMenuOpenId(null); setSettingsTeam(t); }}>
                      Settings
                    </button>
                    <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteTeam(t.groupId)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>Got an invitation? Join your team!</p>
          <div className={styles.joinRow}>
            <input
              className={styles.input}
              placeholder="Paste invitation code…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && joinTeam()}
            />
            <button className={styles.btn} onClick={joinTeam} disabled={joining || !joinCode.trim()}>
              {joining ? "Joining…" : "Join"}
            </button>
          </div>
          {joinError && <p className={styles.joinError}>{joinError}</p>}
        </div>
      </main>

      {settingsTeam && (
        <SettingsModal
          type="team"
          id={settingsTeam.groupId}
          name={settingsTeam.name || settingsTeam.groupId.slice(0, 8)}
          onClose={() => setSettingsTeam(null)}
        />
      )}
    </div>
  );
}
