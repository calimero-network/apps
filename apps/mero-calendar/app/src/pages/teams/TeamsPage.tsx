import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { listNamespaces, selfIsGroupAdmin } from "../../api/admin";
import { loadAccountId } from "../../api/identity";
import { useEnsureAppId } from "../../hooks/useEnsureAppId";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import LogoutButton from "../../components/common/logout-button/LogoutButton";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage } from "../../utils/errorMessage";
import { encodeInvitationObject, invitationLink } from "../../utils/invitation";
import {
  getStoredTeamName,
  setStoredTeamName,
  teamLabel,
} from "../../utils/teamName";
import {
  forgetTeam,
  pickRemembered,
  readLastVisit,
  shouldResume,
} from "../../utils/lastVisit";
import type { Team } from "../../types/workspace";
import styles from "./teams.module.scss";

export default function TeamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  // `admin`, NOT `mero.admin`. `mero` is the raw client, and on a delegated
  // (account) session its transport is the relay: `mero.admin.createNamespace`
  // is `POST {relay}/admin-api/namespaces` under the account's bearer token,
  // which carries no `namespace:manage` — a 403. `admin` is the session-aware
  // one: the node's own client on a node login, and on an account the account
  // admin, which founds through the relay and signs invitations as the account
  // (joining is `components/common/invitation-prompt`'s).
  const { admin, isDelegated, nodeUrl } = useMero();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // The node has answered the list (empty or not). A failed read has not, and
  // must not forget a team it simply could not see.
  const [listed, setListed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<{ id: string; link: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  // Whether this session is an Admin of each team, by team id. Absent while
  // unknown: the menu then offers neither Delete nor Leave rather than guessing.
  const [adminOf, setAdminOf] = useState<Record<string, boolean>>({});

  // Mero Calendar's own application id (see hooks/useEnsureAppId).
  const ensureAppId = useEnsureAppId();

  /** The session-aware admin, or a clear refusal before anything is sent. */
  const requireAdmin = useCallback(() => {
    if (!admin) throw new Error("Not connected.");
    return admin;
  }, [admin]);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      // An account learns its application id from the registry only after it
      // has signed in. Until then nothing can be listed for it, and an empty
      // answer would read as "no teams": the page would offer to create one
      // and forget the team you had open. Wait; `ensureAppId` changes when the
      // id lands, and that runs this again.
      if (!appId && isDelegated) return;
      listNamespaces(requireAdmin(), appId)
        .then((items) => {
          if (cancelled) return;
          const arr = Array.isArray(items) ? items : [];
          setTeams(
            arr.map((n) => ({
              groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
              name: n.alias ?? n.name ?? "",
            })),
          );
          setListed(true);
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
  }, [admin, ensureAppId, isDelegated, requireAdmin]);

  // Resume the team open last (utils/lastVisit) when this is the default
  // landing, not a visit you chose, and this node still lists it. Anything
  // else settles here: a remembered team the node no longer lists is
  // forgotten, and the entry is replaced so Back or a reload to it is a
  // plain visit to the list.
  const resume = shouldResume(location);
  const remembered = readLastVisit(nodeUrl).team;
  const resumeTo =
    resume && listed
      ? pickRemembered(
          teams.map((t) => t.groupId),
          remembered,
        )
      : null;
  useEffect(() => {
    if (!resume || loading || resumeTo) return;
    if (listed && remembered) forgetTeam(nodeUrl, remembered);
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [
    resume,
    loading,
    listed,
    resumeTo,
    remembered,
    nodeUrl,
    navigate,
    location.pathname,
    location.search,
  ]);

  // An Admin deletes a team; anyone else leaves it. Asked of each team's own
  // member listing, by the account this session runs as. Keyed on the ids, so
  // the 30s list poll does not re-ask while the teams stay the same.
  const teamIds = teams.map((t) => t.groupId).join(",");
  useEffect(() => {
    const ids = teamIds ? teamIds.split(",") : [];
    if (!admin || ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const self = await loadAccountId(admin);
      const entries = await Promise.all(
        ids.map(async (id) => [id, await selfIsGroupAdmin(admin, id, self)] as const),
      );
      if (!cancelled) setAdminOf(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [admin, teamIds]);

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
      const applicationId = await ensureAppId();
      // Not founded without one: a namespace bound to no application is a team
      // this app can never list again.
      if (!applicationId) throw new Error("Still connecting. Try again in a moment.");
      // Body is EXACTLY `applicationId` + `name`: `CreateNamespaceApiRequest`
      // is `deny_unknown_fields`, so an extra key is a 400 for the whole
      // create. On an account the same call founds through the relay with the
      // provider's package, and comes back with `haEnabled`/`haError` on top.
      const data = (await requireAdmin().createNamespace({
        applicationId,
        name,
      })) as {
        namespaceId?: string;
        groupId?: string;
        id?: string;
        haEnabled?: boolean;
        haError?: string;
      };
      const id = data.namespaceId ?? data.groupId ?? data.id ?? "";
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
      // The team exists either way; only hosting was refused. Said now, where
      // it can be acted on, rather than at the first invite, where it would
      // read as a broken link.
      if (data.haError) {
        showToast(
          `Team created, but invitations will not work yet: ${data.haError}.`,
        );
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  /**
   * Admin only, and node-only: the account admin refuses it, so the control is
   * hidden there. The card goes once the node has accepted the delete; a
   * refusal is said, not swallowed.
   */
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await requireAdmin().deleteNamespace(teamId);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not delete team."));
      return;
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(nodeUrl, teamId);
  }

  /** Not an admin: leave the team. A node and an account can both. */
  async function leaveTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await requireAdmin().leaveNamespace(teamId);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not leave team."));
      return;
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(nodeUrl, teamId);
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
      // `{ invitation, groupName? }` — the same envelope the node route
      // returned, so the code a node mints and the one an account mints decode
      // identically in the invitation prompt. On an account the invitation is
      // signed by the account itself.
      const data = (await requireAdmin().createNamespaceInvitation(
        teamId,
      )) as unknown as Record<string, unknown>;
      const teamName = getStoredTeamName(teamId);
      const payload = teamName ? { ...data, __teamName: teamName } : data;
      // The link is all there is to share: opening it is how the invitation
      // reaches the other person's app. No raw code is shown or copied.
      setInviteFor({
        id: teamId,
        link: invitationLink(encodeInvitationObject(payload)),
      });
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
    await navigator.clipboard.writeText(inviteFor.link);
    showToast("Invitation link copied to clipboard.", "success");
  }

  if (resumeTo) {
    return (
      <Navigate to={`/teams/${resumeTo}`} replace state={{ resume: true }} />
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <CalendarLogo size={24} color="var(--accent)" /> Mero Calendar
        </span>
        <div className={styles.headerRight}>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

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
            No teams yet. Create one above, or open an invitation link someone
            sent you.
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
                    {/* An Admin deletes, anyone else leaves. Deleting a
                        namespace is a node's own operation; the account
                        admin refuses it by name, so an account is not
                        offered it. */}
                    {adminOf[t.groupId] === true && !isDelegated && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => deleteTeam(t.groupId)}
                        data-testid={`delete-team-${t.groupId}`}
                      >
                        Delete
                      </button>
                    )}
                    {adminOf[t.groupId] === false && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => leaveTeam(t.groupId)}
                        data-testid={`leave-team-${t.groupId}`}
                      >
                        Leave
                      </button>
                    )}
                  </div>
                )}
                {inviteFor?.id === t.groupId && (
                  <div className={styles.inviteBox}>
                    <code className={styles.inviteCode} title={inviteFor.link}>
                      {inviteFor.link.slice(0, 40)}…{inviteFor.link.slice(-8)}
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

      </main>
    </div>
  );
}
