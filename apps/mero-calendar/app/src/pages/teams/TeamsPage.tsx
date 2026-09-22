import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  InviteStatusBanner,
  redeemInvitation,
  useInviteRedemption,
} from "@calimero-apps/invite";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";
import { useMero, setApplicationId } from "@calimero-network/mero-react";
import {
  adminGet,
  adminPost,
  adminPut,
  adminDelete,
  listNamespaces,
  joinContext,
} from "../../api/rpc";
import { resolveApplicationId } from "../../api/appId";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import {
  decodeInvitationObject,
  encodeInvitationObject,
  invitationLink,
  invitationTokenFrom,
} from "../../utils/invitation";
import {
  getStoredTeamName,
  setStoredTeamName,
  teamLabel,
} from "../../utils/teamName";
import type { Team } from "../../types/workspace";
import styles from "./teams.module.scss";

type NamespaceRaw = {
  namespaceId?: string;
  groupId?: string;
  id?: string;
  alias?: string;
  name?: string;
};

type SubgroupRaw = {
  groupId?: string;
  group_id?: string;
  id?: string;
};

type ContextRaw = {
  contextId?: string;
  context_id?: string;
  id?: string;
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
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [inviteFor, setInviteFor] = useState<{ id: string; code: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

  // Mero Calendar's own application id, resolved once per mount (see appId.ts).
  // Resolution already prefers the session's id, but only when the node really
  // has it — so the persisted id is a fallback for the case where we could not
  // reach /applications at all. Shared by list/create/join/open so every
  // namespace + context is scoped to the right app.
  const appIdRef = useRef<string>("");
  const ensureAppId = useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    try {
      id = await resolveApplicationId();
    } catch {
      /* ignore */
    }
    if (!id) id = applicationId ?? "";
    if (id) {
      appIdRef.current = id;
      setApplicationId(id);
    }
    return id;
  }, [applicationId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      listNamespaces(appId)
        .then((items) => {
          if (cancelled) return;
          const arr = Array.isArray(items) ? items : [];
          setTeams(
            arr.map((n) => ({
              groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
              name: n.alias ?? n.name ?? "",
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setTeams([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ensureAppId]);

  // Close dropdown on outside click
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
      const data = await adminPost<{
        namespaceId?: string;
        groupId?: string;
        id?: string;
      }>("/namespaces", {
        // Body is EXACTLY `applicationId` + `name` (+ optional `appKey`).
        // `CreateNamespaceApiRequest` is `deny_unknown_fields`, so an extra key
        // is a 400 for the whole create:
        //   unknown field `alias`, expected one of `applicationId`, `name`,
        //   `appKey`, `bytecodeId`
        // `alias` was the pre-core#2338 spelling of the group label; `name` is
        // the only one a node has read since.
        // (No `upgradePolicy` either: core removed the concept in rc.21.)
        applicationId: await ensureAppId(),
        name,
      });
      const id = data.namespaceId ?? data.groupId ?? data.id ?? "";
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
      /* best-effort */
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
      join: async (namespaceId: string, invitation: unknown) => {
        await adminPost(`/namespaces/${namespaceId}/join`, { invitation });
      },
      memberships: async () => {
        const items = await listNamespaces(await ensureAppId());
        return (Array.isArray(items) ? items : []).map(
          (n: NamespaceRaw) => n.namespaceId ?? n.groupId ?? n.id ?? "",
        );
      },
    }),
    [ensureAppId],
  );

  const refreshTeams = useCallback(async () => {
    const items = await listNamespaces(await ensureAppId()).catch(() => null);
    if (!Array.isArray(items)) return;
    setTeams(
      items.map((n: NamespaceRaw) => ({
        groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
        name: (n.alias ?? n.name ?? "").trim(),
      })),
    );
  }, [ensureAppId]);

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
      navigate(`/teams/${namespaceId}`);
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
      if (outcome.status === "failed") throw new Error(outcome.message);

      markNamespaceJustJoined(outcome.namespaceId);
      await refreshTeams();
      setJoinCode("");
      showToast(
        outcome.status === "already-member"
          ? "You are already in this team."
          : "Joined team. Syncing calendar…",
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


  /**
   * Open a team by showing its calendars, not by guessing one.
   *
   * This used to walk the team's subgroups, take `contexts[0]`, and create a
   * context when it found none — so a team with two calendars could only ever
   * open the first, and a mistakenly created one had nowhere to be deleted
   * from. Navigation is now unconditional and the picker owns both.
   */
  function openTeam(teamId: string) {
    setMenuOpenId(null);
    navigate(`/teams/${teamId}`);
  }

  async function generateInvite(teamId: string) {
    setMenuOpenId(null);
    try {
      const data = await adminPost<Record<string, unknown>>(
        `/namespaces/${teamId}/invite`,
        {},
      );
      const teamName = getStoredTeamName(teamId);
      const payload = teamName ? { ...data, __teamName: teamName } : data;
      const code = encodeInvitationObject(payload);
      setInviteFor({ id: teamId, code });
    } catch (err) {
      showToast(
        extractErrorMessage(err, "Failed to generate invitation."),
      );
    }
  }

  async function copyInvite() {
    if (!inviteFor) return;
    // Share the canonical link, not the bare token: it opens the desktop app
    // where installed and the web build otherwise.
    await navigator.clipboard.writeText(invitationLink(inviteFor.code));
    showToast("Invitation link copied to clipboard.", "success");
  }

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <CalendarLogo size={24} color="var(--accent)" /> Mero Calendar
        </span>
        <div className={styles.headerRight}>
          <ThemeToggle />
          <button className="mc-btn mc-btn--ghost" onClick={handleLogout}>
            Logout
          </button>
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
        <p className={styles.subtitle}>Teams are shared calendars.</p>

        <div className={styles.createRow}>
          <input
            className={`mc-input ${styles.createInput}`}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            data-testid="new-team-input"
          />
          <button
            className="mc-btn mc-btn--primary"
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
          <p className={styles.empty} data-testid="empty-teams">
            No teams yet. Create one above.
          </p>
        ) : (
          <div className={styles.grid}>
            {teams.map((t) => (
              <div
                key={t.groupId}
                className={styles.cardWrap}
                ref={menuOpenId === t.groupId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  onClick={() => openTeam(t.groupId)}
                  data-testid={`team-card-${t.groupId}`}
                >
                  <span className={styles.cardIcon}>
                    <CalendarLogo size={20} color="var(--accent)" />
                  </span>
                  <span className={styles.cardName}>
                    {teamLabel(t.groupId, t.name)}
                  </span>
                  <span className={styles.cardSub}>Shared calendars</span>
                </button>
                <button
                  className={styles.menuBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === t.groupId ? null : t.groupId);
                  }}
                  title="More options"
                  data-testid={`team-menu-${t.groupId}`}
                >
                  ⋯
                </button>
                {menuOpenId === t.groupId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => openTeam(t.groupId)}
                    >
                      Open calendar
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => generateInvite(t.groupId)}
                    >
                      Invite
                    </button>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      onClick={() => deleteTeam(t.groupId)}
                    >
                      Delete
                    </button>
                  </div>
                )}
                {inviteFor?.id === t.groupId && (
                  <div className={styles.inviteBox}>
                    <code className={styles.inviteCode} title={inviteFor.code}>
                      {inviteFor.code.slice(0, 18)}…{inviteFor.code.slice(-8)}
                    </code>
                    <button
                      className="mc-btn"
                      onClick={copyInvite}
                      data-testid="copy-invite"
                    >
                      Copy
                    </button>
                    <button
                      className="mc-btn mc-btn--ghost"
                      onClick={() => setInviteFor(null)}
                    >
                      ✕
                    </button>
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
              className={`mc-input ${styles.createInput}`}
              placeholder="Paste invitation code…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void joinTeam(); }}
              data-testid="join-code-input"
            />
            <button
              className="mc-btn"
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
    </div>
  );
}
