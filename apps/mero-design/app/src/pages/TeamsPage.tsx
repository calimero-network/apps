import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { createNamespace, deleteNamespace, joinNamespace, listNamespaces } from "../api/rpc";
import { useApplicationId } from "../hooks/useApplicationId";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { decodeInvitationObject, invitationTokenFrom } from "../utils/invitation";
import {
  describeInviteFailure,
  InviteStatusBanner,
  redeemInvitation,
  useInviteRedemption,
} from "@calimero-apps/invite";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
import type { Team } from "../types";
import styles from "./TeamsPage.module.css";

export default function TeamsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { logout, isDelegated } = useMero();
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

  // MeroDesign's own application id — see hooks/useApplicationId.
  const ensureAppId = useApplicationId();

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      listNamespaces(appId)
        .then((items) => {
          if (cancelled) return;
          setTeams(items.map((n) => ({ groupId: n.namespaceId, name: n.name ?? "" })));
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
      const appId = await ensureAppId();
      if (!appId) {
        showToast("Select or install the Mero Design application first.");
        return;
      }
      // On a node this is the node's own namespace; on an account the admin
      // founds it through the relay, as the account, and asks the cloud to host
      // it. The body is the same either way.
      const data = await createNamespace(appId, name);
      const id = data.namespaceId;
      // Cache the name so it survives even if the server later returns no alias,
      // and so it can be embedded in invitations for joiners.
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
      // Say it now, not at invite time: an unhosted team's invitations cannot
      // be claimed, and "link this account in the wallet" is the fix.
      if (data.haError) {
        showToast(`Team created, but it is not hosted yet: ${data.haError}`);
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await deleteNamespace(teamId);
    } catch {
      // best-effort
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }

  /**
   * Read a raw invitation token into the parts the join needs.
   *
   * Invitation shape:
   *   { invitation: { invitation: { group_id: [...] }, inviterSignature,
   *     applicationId }, __teamName? }
   * The join body must wrap the invitation struct (`outer`), NOT the whole
   * decoded token.
   */
  const parseInvitation = useCallback((raw: string) => {
    // Use the shared UTF-8-safe decoder so a Unicode __teamName (emoji,
    // accents) round-trips correctly.
    const invObj = decodeInvitationObject<Record<string, unknown>>(raw);
    const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
    const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
    const rawGroupId =
      inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
    const namespaceId = Array.isArray(rawGroupId)
      ? (rawGroupId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
      : String(rawGroupId ?? "");
    if (!namespaceId) return null;

    // The inviter embeds the human team name so the joiner doesn't render a raw ID.
    const teamName =
      typeof invObj.__teamName === "string" ? invObj.__teamName.trim() : "";
    if (teamName) setStoredTeamName(namespaceId, teamName);

    return { namespaceId, invitation: outer, teamName: teamName || undefined };
  }, []);

  /** The two calls @calimero-apps/invite needs from this app. */
  const redeemer = useMemo(
    () => ({
      join: async (namespaceId: string, invitation: unknown) => {
        await joinNamespace(namespaceId, invitation);
      },
      memberships: async () => {
        const items = await listNamespaces(await ensureAppId());
        return items.map((n) => n.namespaceId);
      },
    }),
    [ensureAppId],
  );

  const refreshTeams = useCallback(async () => {
    const items = await listNamespaces(await ensureAppId()).catch(() => null);
    if (!items) return;
    setTeams(items.map((n) => ({ groupId: n.namespaceId, name: (n.name ?? "").trim() })));
  }, [ensureAppId]);

  // ── An invitation link opened this app ──────────────────────────────────────
  //
  // Capture, redemption and the attempt cap all live in @calimero-apps/invite;
  // this page supplies the codec and the two calls, and renders the result.
  // `invite.state` drives the banner below: joining → joined / already in it /
  // the node's own error.
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
          : "Joined team. Syncing projects…",
        "success",
      );
      return true;
    } catch (err) {
      const msg = extractErrorMessage(err, "Could not join. Check the invitation code.");
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
        <span className={styles.logo}><Logo size={24} /> Mero Design</span>
        <div className={styles.headerRight}>
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

        {/* Following an invite link used to land here with nothing on screen
            for as long as the join took — up to 95s when no member of the
            namespace was online. */}
        <InviteStatusBanner
          state={invite.state}
          noun="team"
          onRetry={invite.retry}
          onDismiss={invite.dismiss}
          style={{ marginBottom: "1rem" }}
        />

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
                    {/* Deleting a namespace is a node's own operation; an
                        account's relay has no form of it. */}
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
          <p className={styles.joinLabel}>Got an invitation? Join your team!</p>
          <div className={styles.joinRow}>
            <input
              className={styles.input}
              placeholder="Paste invitation code…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && joinTeam()}
            />
            <button className={styles.btn} onClick={() => void joinTeam()} disabled={joining || !joinCode.trim()}>
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
