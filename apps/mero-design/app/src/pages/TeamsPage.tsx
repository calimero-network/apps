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
import ThemeToggle from "../components/ThemeToggle";
import { EmptyTeamsArt } from "../components/Artwork";
import { initialsOf, tileGradient } from "../utils/artwork";
import { IconLink, IconPlus } from "../components/HomeIcons";
import { truncateMiddle } from "../utils/format";
import styles from "./Home.module.css";

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

  const createField = (
    <div className={styles.field}>
      <input
        className={styles.input}
        placeholder="New team name…"
        aria-label="New team name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && createTeam()}
      />
      <button className={styles.btn} onClick={createTeam} disabled={creating}>
        Create
      </button>
    </div>
  );

  const joinCard = (
    <section className={`${styles.panel} ${styles.actionCard}`}>
      <div className={styles.actionHead}>
        <span className={`${styles.actionIcon} ${styles.actionIconAlt}`} aria-hidden="true">
          <IconLink />
        </span>
        <span>
          <span className={styles.actionTitle}>Got an invitation? Join your team!</span>
          <span className={styles.actionHint}>Paste the link or code a teammate sent you.</span>
        </span>
      </div>
      <div className={styles.field}>
        <input
          className={styles.input}
          placeholder="Paste invitation code…"
          aria-label="Invitation code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && joinTeam()}
        />
        <button className={styles.btn} onClick={() => void joinTeam()} disabled={joining || !joinCode.trim()}>
          {joining ? "Joining…" : "Join"}
        </button>
      </div>
      {joinError && <p className={styles.errorText}>{joinError}</p>}
    </section>
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.brand}><Logo size={30} /> <span className={styles.brandText}>Mero Design</span></span>
        <div className={styles.headerRight}>
          <ThemeToggle className={styles.iconBtn} />
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Workspace</p>
            <h1 className={styles.title}>Your Teams</h1>
            <p className={styles.subtitle}>
              A team is the people you design with. Its boards live on its members&rsquo; nodes and sync
              between them directly, with no server keeping a copy.
            </p>
          </div>
        </div>

        {/* Following an invite link used to land here with nothing on screen
            for as long as the join took — up to 95s when no member of the
            namespace was online. */}
        <InviteStatusBanner
          state={invite.state}
          noun="team"
          onRetry={invite.retry}
          onDismiss={invite.dismiss}
          style={{ marginBottom: "1.5rem" }}
        />

        {loading ? (
          <div className={styles.grid} aria-busy="true" aria-label="Loading teams">
            {[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
          </div>
        ) : teams.length === 0 ? (
          <>
            <section className={`${styles.panel} ${styles.empty}`}>
              <EmptyTeamsArt />
              <h2 className={styles.emptyTitle}>Start your first team</h2>
              <p className={styles.emptyText}>
                No teams yet. Name one and create it, then invite people from its page.
              </p>
              <div className={styles.emptyField}>{createField}</div>
            </section>
            {joinCard}
          </>
        ) : (
          <>
            <div className={styles.actions}>
              <section className={`${styles.panel} ${styles.actionCard}`}>
                <div className={styles.actionHead}>
                  <span className={styles.actionIcon} aria-hidden="true"><IconPlus /></span>
                  <span>
                    <span className={styles.actionTitle}>New team</span>
                    <span className={styles.actionHint}>Name it, then invite people from inside.</span>
                  </span>
                </div>
                {createField}
              </section>
              {joinCard}
            </div>

            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Teams</h2>
              <span className={styles.count}>{teams.length}</span>
            </div>
            <div className={styles.grid}>
              {teams.map((t) => {
                const label = teamLabel(t.groupId, t.name);
                const open = menuOpenId === t.groupId;
                return (
                  <div
                    key={t.groupId}
                    className={`${styles.cardWrap} ${open ? styles.cardWrapOpen : ""}`}
                    ref={open ? menuRef : null}
                  >
                    <button
                      className={styles.card}
                      onClick={() => navigate(`/teams/${t.groupId}/projects`)}
                    >
                      <span className={styles.teamBanner} style={{ background: tileGradient(t.groupId) }}>
                        <span className={styles.avatar} aria-hidden="true">{initialsOf(label)}</span>
                      </span>
                      <span className={styles.cardBody}>
                        <span className={styles.cardName}>{label}</span>
                        <span className={styles.cardMeta}>
                          Team <span className={styles.metaDot} aria-hidden="true" />
                          <span className={styles.metaId}>{truncateMiddle(t.groupId, 6, 4)}</span>
                        </span>
                      </span>
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(open ? null : t.groupId); }}
                      title="More options"
                    >⋯</button>
                    {open && (
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
                );
              })}
            </div>
          </>
        )}
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
