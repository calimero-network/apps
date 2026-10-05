import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  describeInviteFailure,
  InviteStatusBanner,
  redeemInvitation,
  useInviteRedemption,
} from "@calimero-apps/invite";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";
import type { SignedGroupOpenInvitation } from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";
import { useApi } from "../api/useApi";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { decodeInvitationObject, invitationTokenFrom } from "../utils/invitation";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
import type { Team } from "../types";
import styles from "./TeamsPage.module.css";

/** What `createNamespace` answers on an account: founding also asks the cloud to host (HA). */
type CreatedNamespace = { namespaceId?: string; haEnabled?: boolean; haError?: string };

export default function TeamsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { logout } = useMero();
  // The session-aware API (see api/useApi): the node's own admin on a node
  // login, the account admin on a delegated session. Shared by list/create/join
  // so namespaces are always scoped to (and created under) the right app.
  const api = useApi();
  const { admin, isDelegated } = api;
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

  const refreshTeams = useCallback(async () => {
    const items = await api.listNamespaces(await api.ensureAppId()).catch(() => null);
    if (!Array.isArray(items)) return;
    setTeams(
      items.map((n) => ({
        groupId: n.namespaceId ?? "",
        name: (n.name ?? "").trim(),
      })),
    );
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await api.ensureAppId();
      api.listNamespaces(appId)
        .then((items) => {
          if (cancelled) return;
          setTeams(items.map((n) => ({
            groupId: n.namespaceId ?? "",
            name: n.name ?? "",
          })));
        })
        .catch(() => { if (!cancelled) setTeams([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [api]);

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
      const applicationId = await api.ensureAppId();
      if (!applicationId) {
        showToast("Select or install the Mero PixArt application first.");
        return;
      }
      // Body is EXACTLY `applicationId` + `name`: `CreateNamespaceApiRequest`
      // is `deny_unknown_fields`, so an extra key is a 400 for the whole
      // create. On an account this founds through the relay with the
      // provider's package, and also asks the cloud to host the namespace so
      // invitees can find it — `haError` says why when it could not.
      const data = (await admin.createNamespace({ applicationId, name })) as CreatedNamespace;
      const id = data.namespaceId ?? "";
      // Cache the name so it survives even if the server later returns no name,
      // and so it can be embedded in invitations for joiners.
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
      if (data.haError) {
        // Said now, where it can be acted on, rather than at invite time.
        showToast(`Team created, but it is not hosted yet: ${data.haError}`);
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  // A node's own operation: deleting a namespace has no account form, so the
  // control is hidden on a delegated session rather than offered and refused.
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await admin.deleteNamespace(teamId);
    } catch {
      // best-effort
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }

  /** Read a raw invitation token into the parts the join needs. */
  const parseInvitation = useCallback((raw: string) => {
    const invObj = decodeInvitationObject<Record<string, unknown>>(raw);
    const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
    const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
    const rawGroupId =
      inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
    const namespaceId = Array.isArray(rawGroupId)
      ? (rawGroupId as number[])
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      : String(rawGroupId ?? "");
    if (!namespaceId) return null;

    const teamName =
      typeof invObj.__teamName === "string" ? invObj.__teamName.trim() : "";
    if (teamName) setStoredTeamName(namespaceId, teamName);

    return { namespaceId, invitation: outer, teamName: teamName || undefined };
  }, []);

  /** The two calls @calimero-apps/invite needs from this app. */
  const redeemer = useMemo(
    () => ({
      // `admin.joinNamespace`, the session-aware one: on an account it redeems
      // through the admitter's route and moves the session onto that relay;
      // the raw node route is a 403 for an account.
      join: async (namespaceId: string, invitation: unknown) => {
        await admin.joinNamespace(namespaceId, {
          invitation: invitation as SignedGroupOpenInvitation,
        });
      },
      memberships: async () => {
        const items = await api.listNamespaces(await api.ensureAppId());
        return items.map((n) => n.namespaceId ?? "");
      },
    }),
    [api, admin],
  );

  // ── An invitation link opened this app ──────────────────────────────────────
  //
  // Capture, redemption and the attempt cap all live in @calimero-apps/invite;
  // this page supplies the codec and the two calls, and renders the result.
  const invite = useInviteRedemption({
    parse: parseInvitation,
    redeemer,
    onJoined: (namespaceId) => {
      setJoinCode("");
      void refreshTeams();
      navigate(`/teams/${namespaceId}/projects`);
    },
  });

  // Keep the manual field in step, so a link that could not be joined
  // automatically is one click away rather than lost.
  useEffect(() => {
    if (invite.token) setJoinCode(invite.token);
  }, [invite.token]);

  /** The manual "paste a code and press Join" path. */
  async function joinTeam(codeOverride?: string): Promise<boolean> {
    const raw = invitationTokenFrom(codeOverride ?? joinCode);
    if (!raw) return false;
    setJoining(true);
    setJoinError("");
    try {
      const parsed = parseInvitation(raw);
      if (!parsed) throw new Error("no namespace id in invitation");

      const outcome = await redeemInvitation(parsed, redeemer);
      if (outcome.status === "failed") {
        throw new Error(
          describeInviteFailure(outcome.reason, "team") ?? outcome.message,
        );
      }

      markNamespaceJustJoined(outcome.namespaceId);
      await refreshTeams();
      setJoinCode("");
      showToast(
        outcome.status === "already-member"
          ? "You are already in this team."
          : "Joined team. Syncing artwork…",
        "success",
      );
      return true;
    } catch (err) {
      const msg = extractErrorMessage(
        err,
        "Could not join. Check the invitation code.",
      );
      setJoinError(msg);
      showToast(msg);
      return false;
    } finally {
      setJoining(false);
    }
  }


  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}><Logo size={24} /> Mero PixArt</span>
        <div className={styles.headerRight}>
          <button className="mp-btn mp-btn--ghost" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

        {/* Following an invite link used to land here with nothing on screen
            for as long as the join took. */}
        <InviteStatusBanner
          state={invite.state}
          noun="team"
          onRetry={invite.retry}
          onDismiss={invite.dismiss}
          style={{ marginBottom: "1rem" }}
        />
        <p className={styles.subtitle}>Teams are shared workspaces. Each holds image projects you edit together.</p>

        <div className={styles.createRow}>
          <input
            className={`mp-input ${styles.createInput}`}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            data-testid="new-team-input"
          />
          <button
            className="mp-btn mp-btn--primary"
            onClick={createTeam}
            disabled={creating || !newName.trim()}
            data-testid="create-team-btn"
          >
            {creating ? "Creating…" : "Create team"}
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : teams.length === 0 ? (
          <p className={styles.empty} data-testid="empty-teams">No teams yet. Create one above.</p>
        ) : (
          <div className={styles.grid}>
            {teams.map((t) => (
              <div key={t.groupId} className={styles.cardWrap} ref={menuOpenId === t.groupId ? menuRef : null}>
                <button
                  className={styles.card}
                  onClick={() => navigate(`/teams/${t.groupId}/projects`)}
                  data-testid={`team-card-${t.groupId}`}
                >
                  <span className={styles.cardIcon}><Logo size={20} color="var(--accent)" /></span>
                  <span className={styles.cardName}>{teamLabel(t.groupId, t.name)}</span>
                  <span className={styles.cardSub}>Team workspace</span>
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
                    {!isDelegated && (
                      <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteTeam(t.groupId)}>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>Got an invitation? Join a team.</p>
          <div className={styles.joinRow}>
            <input
              className={`mp-input ${styles.createInput}`}
              placeholder="Paste invitation code…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void joinTeam(); }}
              data-testid="join-code-input"
            />
            <button
              className="mp-btn"
              onClick={() => void joinTeam()}
              disabled={joining || !joinCode.trim()}
              data-testid="join-team-btn"
            >
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
