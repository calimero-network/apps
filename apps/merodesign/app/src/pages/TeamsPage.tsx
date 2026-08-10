import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero, setApplicationId } from "@calimero-network/mero-react";
import { adminPost, adminDelete, listNamespaces } from "../api/rpc";
import { resolveApplicationId } from "../api/appId";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { decodeInvitationObject, invitationTokenFrom } from "../utils/invitation";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
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
  const { showToast } = useToast();
  const { applicationId, logout } = useMero();
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

  // MeroDesign's own application id, resolved once per mount.
  // resolveApplicationId is authoritative — the pinned production id when the node has it, else
  // the installed app whose package is com.calimero.merodesign. We prefer it
  // over a possibly-stale/wrong id from persisted auth or the Tauri hash, and
  // only fall back to that id if resolution fails. Shared by list/create/join
  // so namespaces are always scoped to (and created under) the right app.
  const appIdRef = useRef<string>("");
  const ensureAppId = useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    try { id = await resolveApplicationId(); } catch { /* ignore */ }
    if (!id) id = applicationId ?? "";
    if (id) { appIdRef.current = id; setApplicationId(id); }
    return id;
  }, [applicationId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      listNamespaces<NamespaceRaw[]>(appId)
        .then((items) => {
          if (cancelled) return;
          const arr = Array.isArray(items) ? items : [];
          setTeams(arr.map((n) => ({
            groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
            name: n.alias ?? n.name ?? "",
          })));
        })
        .catch(() => { if (!cancelled) setTeams([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ensureAppId]);

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
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const data = await adminPost<{ namespaceId?: string; groupId?: string; id?: string }>(
        "/namespaces",
        { applicationId: await ensureAppId(), alias: name, name, upgradePolicy: "LazyOnAccess" },
      );
      const id = data.namespaceId ?? data.groupId ?? data.id ?? "";
      // Cache the name so it survives even if the server later returns no alias,
      // and so it can be embedded in invitations for joiners.
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
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
    // Accept either a shared invitation link or the bare token inside it.
    const raw = invitationTokenFrom(joinCode);
    if (!raw) return;
    setJoining(true);
    setJoinError("");
    try {
      // Decode base64url → JSON invitation object. Use the shared UTF-8-safe
      // decoder so a Unicode __teamName (emoji/accents) round-trips correctly.
      const invObj = decodeInvitationObject<Record<string, unknown>>(raw);

      // Invitation structure: { invitation: { invitation: { group_id: [...] }, inviterSignature, applicationId }, __teamName? }
      // group_id lives at invObj.invitation.invitation.group_id
      const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
      const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
      const rawGroupId = inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
      const namespaceId = Array.isArray(rawGroupId)
        ? (rawGroupId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
        : String(rawGroupId ?? "");

      if (!namespaceId) throw new Error("no namespace id in invitation");

      // The inviter embeds the human team name so the joiner doesn't render a raw ID.
      const embeddedName = typeof invObj.__teamName === "string" ? invObj.__teamName.trim() : "";
      if (embeddedName) setStoredTeamName(namespaceId, embeddedName);

      // Join body must wrap the invitation struct (outer), not the whole decoded token
      await adminPost(`/namespaces/${namespaceId}/join`, { invitation: outer });
      // Refresh list
      const items = await listNamespaces<NamespaceRaw[]>(await ensureAppId());
      const arr = Array.isArray(items) ? items : [];
      setTeams(arr.map((n) => {
        const gid = n.namespaceId ?? n.groupId ?? n.id ?? "";
        const serverName = (n.alias ?? n.name ?? "").trim();
        if (gid === namespaceId && embeddedName && !serverName) return { groupId: gid, name: embeddedName };
        return { groupId: gid, name: serverName };
      }));
      setJoinCode("");
      showToast("Joined team. Syncing projects…", "success");
    } catch (err) {
      const msg = extractErrorMessage(err, "Could not join. Check the invitation code.");
      setJoinError(msg);
      showToast(msg);
    } finally {
      setJoining(false);
    }
  }

  function handleLogout() {
    logout();
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
                  <span className={styles.cardName}>{teamLabel(t.groupId, t.name)}</span>
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
          name={teamLabel(settingsTeam.groupId, settingsTeam.name)}
          onClose={() => setSettingsTeam(null)}
        />
      )}
    </div>
  );
}
